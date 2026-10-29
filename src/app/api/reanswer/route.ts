import { NextResponse } from "next/server";
import { getAIService } from "@/lib/ai";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { badRequest, createErrorResponse, ErrorCode } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { describeQuestion, trackBackgroundTask } from "@/lib/background-tasks";
import { prisma } from "@/lib/prisma";
import { getNotebookCandidateTags } from "@/lib/ai/tag-service";
import { resolveNotebookScope } from "@/lib/notebook-scope";
import type { CandidateTags } from "@/lib/ai";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withRecoverableResponse } from "@/lib/recoverable-response";

const logger = createLogger('api:reanswer');

async function handlePost(req: Request) {
    logger.info('Reanswer API called');

    const session = await getServerSession(authOptions);

    // 认证检查
    if (!session) {
        logger.warn('Unauthorized access attempt');
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { questionText, language = 'zh', subject, imageBase64, gradeSemester, subjectId } = body;

        logger.debug({
            questionLength: questionText?.length,
            language,
            subject,
            hasImage: !!imageBase64,
            gradeSemester
        }, 'Reanswer request received');

        if (!questionText || questionText.trim().length === 0) {
            logger.warn('Missing question text');
            return badRequest("Missing question text");
        }

        // 指定了错题本时，知识点只能从该错题本学段 + 学科下的全部标签中选择
        let candidateTags: CandidateTags | undefined;
        if (typeof subjectId === 'string' && subjectId && session.user?.email) {
            const notebook = await prisma.subject.findFirst({
                where: { id: subjectId, user: { email: session.user.email } },
                select: { name: true, stage: true, subjectKey: true },
            });
            if (notebook) {
                candidateTags = await getNotebookCandidateTags(resolveNotebookScope(notebook));
            }
        }

        const limited = await consumeAiQuota(session.user, 'reanswer');
        if (limited) return limited;

        const aiService = getAIService();

        // 根据是否有图片选择不同的重新解题方式
        const result = await trackBackgroundTask(
            { userId: session.user.id, kind: 'reanswer', subject: describeQuestion({ questionText }) },
            () => aiService.reanswerQuestion(questionText, language, subject, imageBase64, gradeSemester, candidateTags)
        );

        logger.info('Reanswer successful');

        return NextResponse.json(result);
    } catch (error: unknown) {
        const errorMessageFromError = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        logger.error({ error: errorMessageFromError, stack }, 'Reanswer error occurred');

        let errorMessage = errorMessageFromError || "Failed to reanswer question";

        if (errorMessageFromError.includes('AI_AUTH_ERROR')) {
            errorMessage = 'AI_AUTH_ERROR';
        } else if (errorMessageFromError === 'AI_CONNECTION_FAILED') {
            errorMessage = 'AI_CONNECTION_FAILED';
        } else if (errorMessageFromError === 'AI_RESPONSE_ERROR') {
            errorMessage = 'AI_RESPONSE_ERROR';
        }

        return createErrorResponse(errorMessage, 500, ErrorCode.AI_ERROR);
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(handlePost);
