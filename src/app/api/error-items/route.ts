import { withUser } from "@/lib/api-handler";
import type { AuthenticatedContext } from "@/lib/api-handler";
import { validationError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { importSchema, saveQuestion } from "@/lib/question/question-save";
import { questionSaveErrorResponse, saveQuestionResultToResponse } from "@/lib/question/question-save-response";

const logger = createLogger('api:error-items');

export const POST = withUser(async (req: Request, { user }: AuthenticatedContext) => {
    logger.info('POST /api/error-items called');

    try {
        const parsed = importSchema.safeParse(await req.json());
        if (!parsed.success) return validationError('QUESTION_SAVE_INVALID_INPUT', parsed.error.issues);
        const body = parsed.data;
        // 记录请求参数（不记录完整图片数据）
        logger.debug({
            hasQuestionText: !!body.questionText,
            questionTextLength: body.questionText?.length || 0,
            hasAnswerText: !!body.answerText,
            hasAnalysis: !!body.analysis,
            hasWrongAnswerText: !!body.wrongAnswerText,
            hasMistakeAnalysis: !!body.mistakeAnalysis,
            mistakeStatus: body.mistakeStatus,
            knowledgePointsCount: Array.isArray(body.knowledgePoints) ? body.knowledgePoints.length : 0,
            hasImage: !!body.originalImageUrl,
            imageSize: body.originalImageUrl?.length || 0,
            subjectId: body.subjectId,
            subjectName: body.subjectName,
            gradeSemester: body.gradeSemester,
            paperLevel: body.paperLevel,
            hasGeogebraCommands: !!body.geogebraCommands,
        }, 'Request parameters received');

        const result = await saveQuestion(user, body);
        return saveQuestionResultToResponse(result);
    } catch (error) {
        logger.error({
            error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined
        }, 'Error saving item');
        return questionSaveErrorResponse(error);
    }
});
