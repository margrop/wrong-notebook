/**
 * 题目类型常量与规范化工具。
 * 题型字段在导入、编辑、展示与备份中使用，统一由此模块维护。
 */

export const QUESTION_TYPES = [
    "single_choice",
    "multiple_choice",
    "true_false",
    "fill_blank",
    "calculation",
    "solution",
    "reading",
    "cloze",
    "writing",
    "other",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/** 下拉框中「清除题型」选项的值（Radix Select 不允许空字符串作为选项值） */
export const NO_QUESTION_TYPE = "__none__";

/** 题型中文显示名（i18n key: questionType.names） */
export const QUESTION_TYPE_NAMES_ZH: Record<QuestionType, string> = {
    single_choice: "单选题",
    multiple_choice: "多选题",
    true_false: "判断题",
    fill_blank: "填空题",
    calculation: "计算题",
    solution: "解答题",
    reading: "阅读理解",
    cloze: "完形填空",
    writing: "写作",
    other: "其他",
};

/** 题型英文显示名（i18n key: questionType.names） */
export const QUESTION_TYPE_NAMES_EN: Record<QuestionType, string> = {
    single_choice: "Single Choice",
    multiple_choice: "Multiple Choice",
    true_false: "True / False",
    fill_blank: "Fill in the Blank",
    calculation: "Calculation",
    solution: "Solution",
    reading: "Reading Comprehension",
    cloze: "Cloze",
    writing: "Writing",
    other: "Other",
};

/** 别名映射：中英文名称与常见别名 → 标准 key */
const QUESTION_TYPE_ALIASES: Record<string, QuestionType> = {
    // 英文 key 与英文别名
    single_choice: "single_choice",
    singlechoice: "single_choice",
    "single choice": "single_choice",
    "single-choice": "single_choice",
    multiple_choice: "multiple_choice",
    multiplechoice: "multiple_choice",
    "multiple choice": "multiple_choice",
    "multiple-choice": "multiple_choice",
    multichoice: "multiple_choice",
    "multi choice": "multiple_choice",
    true_false: "true_false",
    truefalse: "true_false",
    "true/false": "true_false",
    "true false": "true_false",
    "true-false": "true_false",
    "true / false": "true_false",
    fill_blank: "fill_blank",
    fillblank: "fill_blank",
    "fill in the blank": "fill_blank",
    "fill-in-the-blank": "fill_blank",
    fillintheblank: "fill_blank",
    calculation: "calculation",
    solution: "solution",
    reading: "reading",
    cloze: "cloze",
    writing: "writing",
    other: "other",
    // 中文别名
    选择题: "single_choice",
    单项选择: "single_choice",
    单选: "single_choice",
    单选题: "single_choice",
    不定项: "multiple_choice",
    不定项选择: "multiple_choice",
    多项选择: "multiple_choice",
    多选: "multiple_choice",
    多选题: "multiple_choice",
    判断: "true_false",
    判断题: "true_false",
    是非: "true_false",
    是非题: "true_false",
    填空: "fill_blank",
    填空题: "fill_blank",
    口算: "calculation",
    计算: "calculation",
    计算题: "calculation",
    解答: "solution",
    解答题: "solution",
    应用: "solution",
    应用题: "solution",
    证明: "solution",
    证明题: "solution",
    简答: "solution",
    简答题: "solution",
    阅读: "reading",
    阅读理解: "reading",
    完形: "cloze",
    完形填空: "cloze",
    作文: "writing",
    写作: "writing",
    书面表达: "writing",
    其他: "other",
};

/**
 * 规范化题型取值：接受标准 key 或常见中英文别名，返回标准 key。
 * 无法识别时返回 null。
 */
export function normalizeQuestionType(value: unknown): QuestionType | null {
    if (typeof value !== "string") return null;
    const key = value.trim().toLowerCase();
    if (!key) return null;
    return QUESTION_TYPE_ALIASES[key] ?? null;
}
