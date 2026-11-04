export const DEFAULT_QUESTION_DUPLICATE_THRESHOLD = 90;

// AI 识别时会在题干后另起一段描述图形（「图示：」「图示信息：」「图示说明：」等），每次措辞都不同
const FIGURE_DESCRIPTION = /^[【[(（]?图示/u;

/** 去掉题干后面的图形描述段落；第一行始终保留，避免误删以「图示」开头的题干本身。 */
function stripFigureDescriptions(text: string): string {
    const kept: string[] = [];
    let seenContent = false;
    let skipping = false;
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
            skipping = false;
        } else if (seenContent && FIGURE_DESCRIPTION.test(trimmed)) {
            skipping = true;
        }
        if (!skipping) kept.push(line);
        if (trimmed) seenContent = true;
    }
    return kept.join('\n');
}

/**
 * 规范化排版差异，保留大小写、数字、运算符和上下标等题意信息：
 * 忽略 AI 附加的图形描述，统一不同长度的填空横线和空括号。
 */
export function normalizeQuestionText(text: string): string {
    return stripFigureDescriptions(text.normalize('NFC'))
        .replace(/[\uFF01-\uFF5E]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
        .replace(/\\underline\{[^}]*\}|_{2,}/g, '__')
        .replace(/\s+/gu, ' ')
        .replace(/\( ?\)/g, '()')
        .trim();
}

/**
 * 完整题干的字符编辑相似度：1 - 编辑距离 / 较长题干长度。
 * 仅返回严格大于所设百分比阈值的分数；其余返回 null。带状计算避免对长题干做平方级比较。
 */
export function duplicateQuestionSimilarity(left: string, right: string, threshold = DEFAULT_QUESTION_DUPLICATE_THRESHOLD): number | null {
    const leftText = normalizeQuestionText(left);
    const rightText = normalizeQuestionText(right);
    if (!leftText || !rightText || threshold >= 100) return null;
    if (leftText === rightText) return 1;

    let a = Array.from(leftText);
    let b = Array.from(rightText);
    if (a.length > b.length) [a, b] = [b, a];

    const length = b.length;
    // 阈值精确到百分之 0.01，使用整数边界避免浮点误差把相等阈值判成重复。
    const maxDistance = Math.ceil(length * (10000 - Math.round(threshold * 100)) / 10000) - 1;
    if (b.length - a.length > maxDistance || maxDistance === 0) return null;

    const infinity = maxDistance + 1;
    let previous = new Int32Array(a.length + 1).fill(infinity);
    let current = new Int32Array(a.length + 1).fill(infinity);
    for (let column = 0; column <= Math.min(a.length, maxDistance); column++) previous[column] = column;

    for (let row = 1; row <= b.length; row++) {
        const start = Math.max(1, row - maxDistance);
        const end = Math.min(a.length, row + maxDistance);
        current[0] = row <= maxDistance ? row : infinity;
        if (start > 1) current[start - 1] = infinity;
        let minimum = current[0];
        for (let column = start; column <= end; column++) {
            current[column] = Math.min(
                previous[column] + 1,
                current[column - 1] + 1,
                previous[column - 1] + (a[column - 1] === b[row - 1] ? 0 : 1),
            );
            minimum = Math.min(minimum, current[column]);
        }
        if (minimum > maxDistance) return null;
        if (end < a.length) current[end + 1] = infinity;
        [previous, current] = [current, previous];
    }

    const distance = previous[a.length];
    return distance <= maxDistance ? 1 - distance / length : null;
}
/** 手动对比时返回完整分数；与导入判重使用相同的规范化方式和字符编辑距离。 */
export function calculateQuestionSimilarity(left: string, right: string): number | null {
    const leftText = normalizeQuestionText(left);
    const rightText = normalizeQuestionText(right);
    if (!leftText || !rightText) return null;
    if (leftText === rightText) return 1;

    let a = Array.from(leftText);
    let b = Array.from(rightText);
    const length = Math.max(a.length, b.length);
    // 相同前后缀不影响编辑距离，先去除以加快近似题目的完整比较。
    let prefix = 0;
    while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++;
    let aEnd = a.length;
    let bEnd = b.length;
    while (aEnd > prefix && bEnd > prefix && a[aEnd - 1] === b[bEnd - 1]) { aEnd--; bEnd--; }
    a = a.slice(prefix, aEnd);
    b = b.slice(prefix, bEnd);
    if (a.length > b.length) [a, b] = [b, a];

    const row = Int32Array.from({ length: a.length + 1 }, (_, index) => index);
    for (let i = 1; i <= b.length; i++) {
        let diagonal = row[0];
        row[0] = i;
        for (let j = 1; j <= a.length; j++) {
            const above = row[j];
            row[j] = Math.min(above + 1, row[j - 1] + 1, diagonal + (a[j - 1] === b[i - 1] ? 0 : 1));
            diagonal = above;
        }
    }
    return 1 - row[a.length] / length;
}
