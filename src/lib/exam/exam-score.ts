/** 试卷题目分值的校验与计算 */

export const MIN_EXAM_SCORE = 0.001;
export const MAX_EXAM_SCORE = 1000;
/** 分值最多保留一位小数 */
export const EXAM_SCORE_DECIMALS = 1;

/**
 * 校验并规范化分值：必须是 0 < score ≤ 1000 的有限数值且最多一位小数
 * （如 2.5 合法，2.55 非法）；非法时返回 null。传入 null 表示清空分值。
 */
export function normalizeExamScore(score: unknown): number | null {
    if (score === null) return null;
    if (typeof score !== 'number' || !Number.isFinite(score)) return null;
    if (score < MIN_EXAM_SCORE || score > MAX_EXAM_SCORE) return null;
    // 最多一位小数；用微小容差规避 0.1*10 之类的浮点误差
    if (Math.abs(score * 10 - Math.round(score * 10)) > 1e-6) return null;
    return Math.round(score * 10) / 10;
}

export interface ExamScoreSummary {
    /** 已设分值的题目数量 */
    scored: number;
    /** 未设分值的题目数量 */
    unscored: number;
    /** 已设分值之和，无分值时返回 null */
    total: number | null;
}

/** 计算试卷总分：只累加已设分值的题目 */
export function summarizeExamScores(scores: (number | null | undefined)[]): ExamScoreSummary {
    let scored = 0;
    let total = 0;
    for (const score of scores) {
        if (typeof score === 'number' && Number.isFinite(score)) {
            scored += 1;
            total += score;
        }
    }
    return { scored, unscored: scores.length - scored, total: scored > 0 ? Math.round(total * 10) / 10 : null };
}

/** 打印用的分值文本：整数不带小数点，一位小数保留（如 2.5） */
export function formatExamScore(score: number): string {
    return Number.isInteger(score) ? String(score) : score.toFixed(1);
}
