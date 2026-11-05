import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, badRequest, conflict, taskAlreadyRunning, validationError, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { EXAM_REGENERATE_MODES, regenerateExamQuestion } from "@/lib/exam/exam";
import { consumeAiQuota } from "@/lib/ai-quota";
import { findRunningTask, reserveBackgroundTask } from "@/lib/background-tasks";
import { withRecoverableResponse } from "@/lib/recoverable-response";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

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
    { user, params }: AuthenticatedContext & { params: Promise<{ id: string; questionId: string }> }
) {
    const { id, questionId } = await params;

    try {
        const parsed = regenerateSchema.safeParse(await req.json().catch(() => ({})));
        if (!parsed.success) {
            return validationError("Invalid regenerate request", parsed.error.issues);
        }

        // 按目标防重复：同一题目同一时刻只允许一个重新生成任务（reserve 失败返回 409，不扣额度、不调用 AI）
        const target = `exam-question:${questionId}:regenerate`;
        const handle = reserveBackgroundTask({
            userId: user.id,
            kind: parsed.data.mode === 'question' ? 'exam' : 'reanswer',
            link: `/exams/${id}`,
            target,
        });
        if (!handle) {
            return taskAlreadyRunning(findRunningTask(user.id, target) ?? { id: '', kind: 'exam', startedAt: '', target });
        }

        const limited = await consumeAiQuota(user, 'exam');
        if (limited) {
            handle.cancel();
            return limited;
        }

        // 内部已对 handle 做 cancel（校验失败）或 fail（AI 失败）收尾
        const updated = await regenerateExamQuestion(id, questionId, user.id, parsed.data.mode, parsed.data.language || 'zh', handle);
        return NextResponse.json(updated);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'EXAM_QUESTION_NOT_FOUND') return notFound("Exam question not found");
        if (message === 'HAS_RESULTS' || message === 'QUESTION_GENERATING') return conflict(message);
        if (message === 'ORIGINAL_MODE') return badRequest("ORIGINAL_MODE");
        if (message === 'SOURCE_DELETED' || message === 'NO_QUESTION_TEXT' || message === 'EMPTY_ANSWER') return badRequest(message);
        logger.error({ error: message }, 'Error regenerating exam question');
        return internalError(message.startsWith('AI_') ? message.split(':')[0] : "Failed to regenerate exam question", { error, scope: "api:exams" });
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(withUser(handlePost));
