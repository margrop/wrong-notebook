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

/** 自动模式下各题型的留白高度（px） */
export const AUTO_ANSWER_SPACE_PX: Record<QuestionKind, number> = {
    choice: 40,
    judgment: 32,
    fill: 64,
    solution: 180,
};

/** 解答题每多一个小问增加的留白，以及解答题留白上限 */
export const SOLUTION_EXTRA_PER_PART_PX = 100;
export const SOLUTION_MAX_PX = 480;

export function isAnswerSpaceMode(value: unknown): value is AnswerSpaceMode {
    return typeof value === 'string' && (ANSWER_SPACE_MODES as readonly string[]).includes(value);
}

// 选项标记：行首或两个以上空白后的 A. / B、/ C：，或括号包住的 (A) / （B）；
// 不认单个空格后的“A、B 两地”，避免把几何点名、地名当作选项
const CHOICE_MARK = /(?:(?:^|\s{2,})([A-D])\s*[.．、:：]|[(（]([A-D])[)）])/gm;
const JUDGMENT_HINT = /判断(?:下列|以下|正误|对错|题)|对的(?:打|画)|错的(?:打|画)|true\s*(?:or|\/)\s*false/i;
// 填空标记：下划线（含 Markdown 转义）、\underline、全角空括号、含空格的半角空括号
const FILL_MARK = /_{3,}|(?:\\_){2,}|\\underline|（\s*）|\(\s+\)|填空/;
// 小问编号：全角（1）任意位置，半角 (1) 只认行首或句读之后，避免把 f(1) 当作小问
const PART_MARK_FULL = /（\s*(\d{1,2})\s*）/g;
const PART_MARK_HALF = /(?:^|[\n。；;：:？?！!]\s*)\(\s*(\d{1,2})\s*\)/g;

/** 根据题干文字推断题型；无法识别时按解答题处理 */
export function detectQuestionKind(text: string): QuestionKind {
    const letters = new Set(Array.from(text.matchAll(CHOICE_MARK), (match) => match[1] ?? match[2]));
    if (letters.has('A') && letters.has('B') && letters.has('C')) return 'choice';
    if (JUDGMENT_HINT.test(text)) return 'judgment';
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
