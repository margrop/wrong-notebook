/** 试卷打印的留白模式：按题型自动，或所有题目使用同一固定高度 */
export type AnswerSpaceMode = 'auto' | 'none' | 'small' | 'medium' | 'large';

export const ANSWER_SPACE_MODES: readonly AnswerSpaceMode[] = ['auto', 'none', 'small', 'medium', 'large'];

export const DEFAULT_ANSWER_SPACE_MODE: AnswerSpaceMode = 'auto';

/** 本地保存用户上次选择的留白模式 */
export const ANSWER_SPACE_STORAGE_KEY = 'exam-print-answer-space';

/** 固定留白高度（px，打印时 96px ≈ 2.54cm） */
export const FIXED_ANSWER_SPACE_PX: Record<Exclude<AnswerSpaceMode, 'auto'>, number> = {
    none: 0,
    small: 60,
    medium: 120,
    large: 240,
};

/** 从题干识别出的题型 */
export type QuestionKind = 'choice' | 'judgment' | 'fill' | 'solution';

/** 自动模式下各题型的留白高度（px）：选择、判断、填空在题干内作答不留大间隔，大题放大写题空间 */
export const AUTO_ANSWER_SPACE_PX: Record<QuestionKind, number> = {
    choice: 12,
    judgment: 12,
    fill: 16,
    solution: 240,
};

/** 解答题每多一个小问增加的留白，以及解答题留白上限 */
export const SOLUTION_EXTRA_PER_PART_PX = 120;
export const SOLUTION_MAX_PX = 560;

/** 单题手动调整留白高度的范围与步进（px） */
export const MIN_CUSTOM_ANSWER_SPACE_PX = 0;
export const MAX_CUSTOM_ANSWER_SPACE_PX = 600;
export const CUSTOM_ANSWER_SPACE_STEP_PX = 20;

export function isAnswerSpaceMode(value: unknown): value is AnswerSpaceMode {
    return typeof value === 'string' && (ANSWER_SPACE_MODES as readonly string[]).includes(value);
}

/** 将手动调整的留白高度限制在合理范围内（0～600px） */
export function clampAnswerSpacePx(px: number): number {
    if (!Number.isFinite(px)) return MIN_CUSTOM_ANSWER_SPACE_PX;
    return Math.min(MAX_CUSTOM_ANSWER_SPACE_PX, Math.max(MIN_CUSTOM_ANSWER_SPACE_PX, Math.round(px)));
}

/** 校验保存的单题留白：0～600 的整数原样返回，其余（含旧数据缺省）返回 null 表示按全局档位 */
export function normalizeCustomAnswerSpacePx(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    if (value < MIN_CUSTOM_ANSWER_SPACE_PX || value > MAX_CUSTOM_ANSWER_SPACE_PX) return null;
    return value;
}

// 选项标记：行首、空白或括号/句读后的 A. / B．/ C: / D：，行首或两个以上空白/括号后的 A、，或括号包住的 (A) / （B）；
// 不认普通文字中单个空格后的“A、B 两地”，避免把几何点名、地名当作选项
const CHOICE_MARK = /(?:(?:^|[\s*+\-)）:：。？?；;，,_])([A-D])\s*[.．:：]|(?:^|\s{2,}|[)）:：。？?])([A-D])\s*、|[(（]([A-D])[)）])/gm;
const JUDGMENT_HINT = /判断(?:下列|以下|正误|对错|题)|对的(?:打|画)|错的(?:打|画)|true\s*(?:or|\/)\s*false/i;
// 填空标记：下划线（含 Markdown 转义）、LaTeX 横线/空白、全角/半角空括号、方括号或句末等号
const FILL_MARK = /_{2,}|(?:\\_){2,}|\\underline|\\rule\b|\\hspace\b|（\s*）|【\s*】|\[\s+\]|(?<![A-Za-z0-9_])\(\s*\)|[=＝]\s*[。？?]?\s*$|填空/;
// 解答/证明题提示词：即使带有局部横线或括号，仍需完整写题空间
const SOLUTION_HINT = /求证|证明[：:，,]|写出(?:解题|计算|推导|推理)?过程|解答下列|试说明理由|请说明理由/;
// 小问编号：全角（1）任意位置，半角 (1) 只认行首或句读之后，避免把 f(1) 当作小问
const PART_MARK_FULL = /（\s*(\d{1,2})\s*）/g;
const PART_MARK_HALF = /(?:^|[\n。；;：:？?！!]\s*)\(\s*(\d{1,2})\s*\)/g;

/** 根据题干文字推断题型；无法识别时按解答题处理 */
export function detectQuestionKind(text: string): QuestionKind {
    const letters = new Set(Array.from(text.matchAll(CHOICE_MARK), (match) => match[1] ?? match[2] ?? match[3]));
    if (letters.has('A') && letters.has('B') && letters.has('C')) return 'choice';
    if (JUDGMENT_HINT.test(text)) return 'judgment';
    if (countQuestionParts(text) > 1 || SOLUTION_HINT.test(text)) return 'solution';
    if (FILL_MARK.test(text)) return 'fill';
    return 'solution';
}

/** 统计题干中的小问数量，至少为 1 */
export function countQuestionParts(text: string): number {
    const numbers = new Set<string>();
    for (const match of text.matchAll(PART_MARK_FULL)) numbers.add(match[1]);
    for (const match of text.matchAll(PART_MARK_HALF)) numbers.add(match[1]);
    return Math.max(1, numbers.size);
}

/** 计算一道题下方的留白高度（px） */
export function getAnswerSpacePx(mode: AnswerSpaceMode, questionText: string): number {
    if (mode !== 'auto') return FIXED_ANSWER_SPACE_PX[mode];
    const kind = detectQuestionKind(questionText);
    if (kind !== 'solution') return AUTO_ANSWER_SPACE_PX[kind];
    const extra = (countQuestionParts(questionText) - 1) * SOLUTION_EXTRA_PER_PART_PX;
    return Math.min(SOLUTION_MAX_PX, AUTO_ANSWER_SPACE_PX.solution + extra);
}

/** 计算一道题最终生效的留白高度：优先使用单题手动覆盖值，否则按全局模式与题型计算 */
export function resolveQuestionAnswerSpacePx(
    mode: AnswerSpaceMode,
    questionText: string,
    customPx?: number | null,
): number {
    if (typeof customPx === 'number' && Number.isFinite(customPx)) {
        return clampAnswerSpacePx(customPx);
    }
    return getAnswerSpacePx(mode, questionText);
}
