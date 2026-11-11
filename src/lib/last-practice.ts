import { z } from 'zod';

/**
 * 每道错题暂存最近一次生成的举一反三题目与解答（存于 ErrorItem.lastPractice），
 * 再次进入练习页时直接显示，不必重新调用 AI 生成。
 */
const LastPracticeSchema = z.object({
    questionText: z.string().min(1),
    answerText: z.string(),
    analysis: z.string(),
    subject: z.string().optional(),
    figureSvg: z.string().nullable().optional(),
    difficulty: z.enum(['easy', 'medium', 'hard', 'harder']),
    /** ai 生成 | bank 真题库选题 | bankVariant 题库题目生成的变式题；旧数据没有此字段时按 ai */
    source: z.enum(['ai', 'bank', 'bankVariant']).optional(),
    generatedAt: z.string(),
});

export type LastPractice = z.infer<typeof LastPracticeSchema>;

export function serializeLastPractice(practice: LastPractice): string {
    return JSON.stringify(LastPracticeSchema.parse(practice));
}

/** 解析暂存内容；为空或格式不合法时返回 null，按未生成处理 */
export function parseLastPractice(raw: string | null | undefined): LastPractice | null {
    if (!raw) return null;
    try {
        const result = LastPracticeSchema.safeParse(JSON.parse(raw));
        return result.success ? result.data : null;
    } catch {
        return null;
    }
}
