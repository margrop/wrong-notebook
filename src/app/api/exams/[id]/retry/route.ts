import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notFound, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { generateExamPaper } from "@/lib/exam/exam";
import { consumeAiQuota } from "@/lib/ai-quota";
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
        // 先检查 AI 额度：额度用完时不能把试卷改成「生成中」，否则会一直卡住
        const limited = await consumeAiQuota(user, 'exam');
        if (limited) return limited;
        await prisma.examPaper.update({ where: { id }, data: { status: 'generating' } });

        void generateExamPaper(id, body.success ? body.data.language || 'zh' : 'zh');

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error({ error }, 'Error retrying exam paper');
        return internalError("Failed to retry exam paper");
    }
});
