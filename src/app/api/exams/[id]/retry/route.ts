import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notFound, internalError, taskAlreadyRunning } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { generateExamPaper } from "@/lib/exam/exam";
import { consumeAiQuota } from "@/lib/ai-quota";
import { findRunningTask, reserveBackgroundTask } from "@/lib/background-tasks";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";

const logger = createLogger('api:exams:retry');

const retrySchema = z.object({ language: z.enum(['zh', 'en']).optional() });

/**
 * POST /api/exams/:id/retry
 * 重新生成失败或未完成的题目
 */
export const POST = withUser(async (
    req: Request,
    { user, params }: AuthenticatedContext & { params: Promise<{ id: string }> }
) => {
    const { id } = await params;

    try {
        const paper = await prisma.examPaper.findUnique({ where: { id }, select: { userId: true, mode: true } });
        if (!paper || paper.userId !== user.id) {
            return notFound("Exam paper not found");
        }
        // 原题直出模式没有失败的题目，无需重试
        if (paper.mode === 'original') {
            return NextResponse.json({ success: true });
        }

        const body = retrySchema.safeParse(await req.json().catch(() => ({})));

        // 按目标防重复：同一试卷同一时刻只允许一个生成任务（reserve 失败返回 409，不扣额度、不调用 AI）
        const target = `exam-paper:${id}:generate`;
        const handle = reserveBackgroundTask({
            userId: user.id,
            kind: 'exam',
            link: `/exams/${id}`,
            target,
        });
        if (!handle) {
            return taskAlreadyRunning(findRunningTask(user.id, target) ?? { id: '', kind: 'exam', startedAt: '', target });
        }

        // 先检查 AI 额度：额度用完时不能把试卷改成「生成中」，否则会一直卡住
        const limited = await consumeAiQuota(user, 'exam');
        if (limited) {
            handle.cancel();
            return limited;
        }
        await prisma.examPaper.update({ where: { id }, data: { status: 'generating' } });

        void generateExamPaper(id, body.success ? body.data.language || 'zh' : 'zh', handle);

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error({ error }, 'Error retrying exam paper');
        return internalError("Failed to retry exam paper", { error, scope: "api:exams" });
    }
});
