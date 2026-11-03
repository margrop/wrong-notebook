import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { unauthorized, validationError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { importSchema, saveQuestionForUser } from "@/lib/question-save";
import { questionSaveErrorResponse } from "@/lib/question-save-error-response";

const logger = createLogger('api:error-items');

export async function POST(req: Request) {
    logger.info('POST /api/error-items called');

    try {
        const session = await getServerSession(authOptions);
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

        // 查找用户
        let user;
        if (session?.user?.email) {
            user = await prisma.user.findUnique({
                where: { email: session.user.email },
            });
            logger.debug({ userId: user?.id, email: session.user.email }, 'User lookup result');
        } else {
            logger.warn('No session email found');
        }

        if (!user) {
            logger.warn({ sessionEmail: session?.user?.email }, 'User not found in DB');
            return unauthorized("No user found in DB");
        }

        return await saveQuestionForUser(user, body);
    } catch (error) {
        logger.error({
            error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined
        }, 'Error saving item');
        return questionSaveErrorResponse(error);
    }
}
