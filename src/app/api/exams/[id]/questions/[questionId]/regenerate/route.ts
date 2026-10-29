import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, notFound, badRequest, conflict, validationError, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { EXAM_REGENERATE_MODES, regenerateExamQuestion } from "@/lib/exam";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withRecoverableResponse } from "@/lib/recoverable-response";

const logger = createLogger('api:exams:regenerate');

const regenerateSchema = z.object({
    mode: z.enum(EXAM_REGENERATE_MODES),
    language: z.enum(['zh', 'en']).optional(),
});

/**
 * POST /api/exams/:id/questions/:questionId/regenerate
 * 单独重新生成一道题：未录入结果时可重新生成题目和解答，录入后只能重新生成解答
 */
async function handlePost(
    req: Request,
    { params }: { params: Promise<{ id: string; questionId: string }> }
) {
    const { id, questionId } = await params;

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const parsed = regenerateSchema.safeParse(await req.json().catch(() => ({})));
        if (!parsed.success) {
            return validationError("Invalid regenerate request", parsed.error.issues);
        }

        const limited = await consumeAiQuota(user, 'exam');
        if (limited) return limited;

        const updated = await regenerateExamQuestion(id, questionId, user.id, parsed.data.mode, parsed.data.language || 'zh');
        return NextResponse.json(updated);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'EXAM_QUESTION_NOT_FOUND') return notFound("Exam question not found");
        if (message === 'HAS_RESULTS' || message === 'QUESTION_GENERATING') return conflict(message);
        if (message === 'SOURCE_DELETED' || message === 'NO_QUESTION_TEXT' || message === 'EMPTY_ANSWER') return badRequest(message);
        logger.error({ error: message }, 'Error regenerating exam question');
        return internalError(message.startsWith('AI_') ? message.split(':')[0] : "Failed to regenerate exam question");
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(handlePost);
