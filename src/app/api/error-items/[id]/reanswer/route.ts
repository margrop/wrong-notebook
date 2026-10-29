import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAIService } from "@/lib/ai";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, notFound, badRequest, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { describeQuestion, trackBackgroundTask } from "@/lib/background-tasks";
import { resolveNotebookScope, SUBJECT_DISPLAY_NAMES } from "@/lib/notebook-scope";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withRecoverableResponse } from "@/lib/recoverable-response";

const logger = createLogger('api:error-items:reanswer');

/**
 * POST /api/error-items/:id/reanswer
 * 根据题目文字（有原图时一并提供）让 AI 重新生成完整的答案和解析并保存；
 * 只覆盖答案和解析，知识点、错误解答、错因分析和难度保持不变。
 */
async function handlePost(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const item = await prisma.errorItem.findUnique({
            where: { id },
            select: {
                userId: true,
                shortId: true,
                questionText: true,
                originalImageUrl: true,
                gradeSemester: true,
                subject: { select: { name: true, stage: true, subjectKey: true } },
            },
        });
        if (!item || item.userId !== user.id) {
            return notFound("Item not found");
        }
        if (!item.questionText?.trim()) {
            return badRequest("NO_QUESTION_TEXT");
        }

        const body = await req.json().catch(() => ({}));
        const language = body?.language === 'en' ? 'en' : 'zh';
        const scope = item.subject ? resolveNotebookScope(item.subject) : null;
        const subject = scope?.subject ? SUBJECT_DISPLAY_NAMES[scope.subject] : null;
        // 原图以 data URL 保存；文字录入的题目没有原图
        const image = item.originalImageUrl?.startsWith('data:') ? item.originalImageUrl : undefined;

        const questionText = item.questionText;
        const limited = await consumeAiQuota(user, 'reanswer');
        if (limited) return limited;

        const result = await trackBackgroundTask(
            { userId: user.id, kind: 'reanswer', subject: describeQuestion(item), link: `/error-items/${id}` },
            () => getAIService().reanswerQuestion(questionText, language, subject, image, item.gradeSemester)
        );
        if (!result.answerText.trim() && !result.analysis.trim()) {
            return badRequest("EMPTY_ANSWER");
        }

        const updated = await prisma.errorItem.update({
            where: { id },
            data: { answerText: result.answerText, analysis: result.analysis },
            select: { answerText: true, analysis: true },
        });
        logger.info({ errorItemId: id, hasImage: !!image, answerLength: updated.answerText?.length ?? 0, analysisLength: updated.analysis?.length ?? 0 }, 'Answer regenerated');
        return NextResponse.json(updated);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message }, 'Error regenerating answer');
        return internalError(message.startsWith('AI_') ? message.split(':')[0] : "Failed to regenerate answer");
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(handlePost);
