/**
 * Markdown 显示前的预处理：先把数学公式片段保护起来，只对公式以外的文字做换行整理，
 * 避免把 \neq、\nabla 中的 "\n" 当作换行，或在 $$…$$ 块内插入空行导致公式无法渲染。
 * 前后端共用，不要引入服务端模块。
 */

// 公式片段：$$…$$、\[…\]、\(…\)、$…$（行内公式不跨行，"\$" 视为转义的美元符号）
const MATH_SEGMENT = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?:\\.|[^$\\\n])+?\$/g;

// AI 偶尔把命令的反斜杠转义成两个（如 \\frac），在公式内还原；只处理常见命令，避免误伤换行符 "\\"
const DOUBLE_ESCAPED_COMMAND = /(?<!\\)\\\\(?=(?:frac|dfrac|tfrac|sqrt|times|div|cdot|pm|mp|leq?|geq?|neq?|approx|equiv|sim|cong|propto|infty|pi|alpha|beta|gamma|delta|theta|lambda|mu|sigma|omega|angle|triangle|perp|parallel|because|therefore|circ|degree|left|right|sum|prod|int|lim|log|ln|sin|cos|tan|text|mathrm|mathbf|overline|underline|vec|overrightarrow|hat|bar|begin|end|quad|qquad|in|notin|subset|subseteq|cup|cap|emptyset|forall|exists|to|rightarrow|Rightarrow|leftrightarrow|Leftrightarrow|ldots|cdots|dots)(?![a-zA-Z]))/g;

const PLACEHOLDER = (index: number) => `@@MATH${index}@@`;
const PLACEHOLDER_PATTERN = /@@MATH(\d+)@@/g;

// 选择题选项标记：支持行首、空白或句读/括号后的 A. / B．/ C: / D：、(A) / （B），以及行首或双空格/括号后的 A、
const CHOICE_OPTION_GLOBAL = /(?:(?:^|[\s*+\-)）:：。？?；;，,_])([A-D])\s*[.．:：]|(?:^|\s{2,}|[)）:：。？?])([A-D])\s*、|[(（]([A-D])[)）])/gm;

/** 判断文本中是否同时包含 A、B、C 三个选择题选项标记 */
export function hasChoiceOptions(text: string): boolean {
    const letters = new Set(
        Array.from(text.matchAll(CHOICE_OPTION_GLOBAL), (m) => m[1] ?? m[2] ?? m[3]),
    );
    return letters.has('A') && letters.has('B') && letters.has('C');
}

/**
 * 将紧跟在题干同一行后面的选择题首选项（A. / (A) / A、等）拆到新行，
 * 并把选项行前的单个换行升级为指定的分隔符（Markdown 用 "\n\n"，纯文本用 "\n"）
 */
export function separateChoiceOptions(text: string, lineBreak: '\n' | '\n\n' = '\n\n'): string {
    if (!hasChoiceOptions(text)) return text;

    let result = text
        // 题干与 A. / A．/ (A) / （A）在同一行时，在 A 选项前插入换行
        .replace(
            /([^\n\s])[ \t]*((?:A\s*[.．:：]|[(（]A[)）]))(?=[\s\S]*(?:[\s)）:：]B\s*[.．、:：]|[(（]B[)）]))/g,
            `$1${lineBreak}$2`,
        )
        // 题干与 A、在同一行（前有双空格或右括号/冒号/问号）时，在 A、前插入换行
        .replace(
            /([^\n\s])(?:\s{2,}|(?<=[)）:：。？?])[ \t]*)(A\s*、)(?=[\s\S]*(?:\sB\s*、|[\s)）]B\s*[.．:：]))/g,
            `$1${lineBreak}$2`,
        );

    if (lineBreak === '\n\n') {
        // 选项行前的单换行转为段落换行，避免 ReactMarkdown 将单换行合并回题干同一行
        result = result.replace(
            /(?<!\n)\n[ \t]*(?=(?:[A-D]\s*[.．、:：]|[(（][A-D][)）]))/g,
            '\n\n',
        );
    }
    return result;
}

/** 统一公式定界符：\[…\] → $$…$$，\(…\) → $…$，并还原被二次转义的命令 */
function normalizeMathSegment(segment: string): string {
    let math = segment;
    if (math.startsWith('\\[')) {
        math = `$$${math.slice(2, -2)}$$`;
    } else if (math.startsWith('\\(')) {
        math = `$${math.slice(2, -2).trim()}$`;
    }
    return math.replace(DOUBLE_ESCAPED_COMMAND, '\\');
}

/** 公式以外文字的整理：字面 "\n" 转为换行，选择题选项与题干分行，句末换行转为分段 */
function normalizeText(text: string): string {
    const withNewlines = text.replace(/\\n/g, '\n');
    return separateChoiceOptions(withNewlines, '\n\n')
        // 保留已有的空行
        .replace(/\n\n/g, '\n\n###PRESERVE_BREAK###\n\n')
        // 句末标点后的单个换行转为分段
        .replace(/([。！？；])\n(?!\n)/g, '$1\n\n')
        .replace(/([.!?;])\s*\n(?!\n)/g, '$1\n\n')
        // 编号 (1)、①② 后的换行转为分段
        .replace(/(\d+\))\s*\n(?!\n)/g, '$1\n\n')
        .replace(/([①-⑳])\s*\n(?!\n)/g, '$1\n\n')
        // 去掉编号行前的缩进，避免被当作代码块
        .replace(/\n\s+([①-⑳])/g, '\n$1')
        .replace(/\n\s+(\d+\))/g, '\n$1')
        .replace(/\s*###PRESERVE_BREAK###\s*/g, '\n\n');
}

/** 一个公式片段：source 为统一定界符后的源码（$…$ 或 $$…$$） */
export interface MathSegment {
    source: string;
    tex: string;
    displayMode: boolean;
}

/**
 * 取出内容中的公式片段，masked 为把公式换成占位符后的其余文字
 */
export function extractMathSegments(content: string | null | undefined): { masked: string; segments: MathSegment[] } {
    const segments: MathSegment[] = [];
    const masked = (content ?? '').replace(MATH_SEGMENT, (raw) => {
        const source = normalizeMathSegment(raw);
        const displayMode = source.startsWith('$$');
        segments.push({ source, tex: source.slice(displayMode ? 2 : 1, displayMode ? -2 : -1), displayMode });
        return PLACEHOLDER(segments.length - 1);
    });
    return { masked, segments };
}

/**
 * 预处理要交给 react-markdown + remark-math 渲染的内容
 */
export function prepareMarkdownMath(content: string | null | undefined): string {
    const { masked, segments } = extractMathSegments(content);
    return normalizeText(masked).replace(PLACEHOLDER_PATTERN, (_match, index: string) => segments[Number(index)].source);
}
