/** 错题编号的显示与解析（前后端共用，不要引入服务端模块） */

/** 题目编号的显示方式：shortId 为 6 位随机 ID（默认），seqNo 为用户内的流水号 #123 */
export const QUESTION_NUMBERING_MODES = ["shortId", "seqNo"] as const;
export type QuestionNumbering = (typeof QUESTION_NUMBERING_MODES)[number];
export const DEFAULT_QUESTION_NUMBERING: QuestionNumbering = "shortId";

export function isQuestionNumbering(value: unknown): value is QuestionNumbering {
    return typeof value === "string" && (QUESTION_NUMBERING_MODES as readonly string[]).includes(value);
}

/** 流水号显示为 #123；没有编号时返回 null */
export function formatSeqNo(seqNo: number | null | undefined): string | null {
    return typeof seqNo === "number" && seqNo > 0 ? `#${seqNo}` : null;
}

/** 按显示方式取题目编号；所选编号缺失时退回另一种，都没有时返回 null */
export function questionNoLabel(
    item: { shortId?: string | null; seqNo?: number | null },
    mode: QuestionNumbering,
): string | null {
    const seqNo = formatSeqNo(item.seqNo);
    const shortId = item.shortId || null;
    return mode === "seqNo" ? seqNo ?? shortId : shortId ?? seqNo;
}

const SEQ_NO_QUERY = /^[#＃]?\s*(\d{1,9})$/;

/** 把搜索或定位输入（如「#12」「12」）解析为流水号；不是编号格式时返回 null */
export function parseSeqNoQuery(value: string | null | undefined): number | null {
    const match = typeof value === "string" ? SEQ_NO_QUERY.exec(value.trim()) : null;
    if (!match) return null;
    const seqNo = Number(match[1]);
    return seqNo > 0 ? seqNo : null;
}
