import { NextResponse } from "next/server";
import { badRequest, createErrorResponse, ErrorCode, reportApiError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/error-message";
import { consumeAiQuota } from "@/lib/ai-quota";
import { withRecoverableResponse } from "@/lib/recoverable-response";
import { analyzeQuestionForUser, mapAnalysisError } from "@/lib/question/question-analysis";
import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { analyzeBodySchema, MAX_AI_REQUEST_BODY_BYTES } from "@/lib/schemas/ai";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/request-body";

const logger = createLogger('api:analyze');

/**
 * 同步识别接口：在请求内等待 AI 返回识别结果。
 * 网页拍照导入改用 /api/import-tasks（服务端持久任务）；本接口保留给 API 调用方与旧版客户端。
 */
async function handlePost(req: Request, { user }: AuthenticatedContext) {
    logger.info('Analyze API called');

    try {
        let rawBody: unknown;
        try {
            rawBody = await readJsonBody(req, MAX_AI_REQUEST_BODY_BYTES);
        } catch (error) {
            if (error instanceof RequestBodyTooLargeError) return badRequest('QUESTION_SAVE_TOO_LARGE');
            throw error;
        }
        const parsed = analyzeBodySchema.safeParse(rawBody);
        if (!parsed.success) {
            logger.warn('Invalid request body');
            return badRequest("Missing image data");
        }
        const { language = 'zh', subjectId, imageBase64, mimeType } = parsed.data;

        logger.debug({
            imageLength: imageBase64?.length,
            mimeType,
            language,
            subjectId
        }, 'Request received');

        const limited = await consumeAiQuota(user, 'analyze');
        if (limited) return limited;

        const analysisResult = await analyzeQuestionForUser({
            email: user.email,
            userId: user.id,
            imageBase64,
            mimeType,
            language,
            subjectId,
        });

        logger.info('AI analysis successful');
        return NextResponse.json(analysisResult);
    } catch (error) {
        const message = getErrorMessage(error);
        logger.error({
            error: message,
            stack: error instanceof Error ? error.stack : undefined
        }, 'Analysis error occurred');

        reportApiError("api:analyze", error);
        // 返回具体的错误类型，便于前端显示详细提示
        return createErrorResponse(mapAnalysisError(message), 500, ErrorCode.AI_ERROR, message);
    }
}

/** 耗时 AI 请求：浏览器中断连接后，前端可通过 /api/requests/:id 取回响应 */
export const POST = withRecoverableResponse(withUser(handlePost));
