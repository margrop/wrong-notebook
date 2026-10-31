import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, notFound, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { generateExamPaper } from "@/lib/exam";
import { consumeAiQuota } from "@/lib/ai-quota";

const logger = createLogger('api:exams:retry');

const retrySchema = z.object({ language: z.enum(['zh', 'en']).optional() });

/**
 * POST /api/exams/:id/retry
 * 重新生成失败或未完成的题目
 */
export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const paper = await prisma.examPaper.findUnique({ where: { id }, select: { userId: true } });
        if (!paper || paper.userId !== user.id) {
            return notFound("Exam paper not found");
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
}
