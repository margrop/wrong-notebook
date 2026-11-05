import { getAIService } from '@/lib/ai';
import { consumeAiQuota } from '@/lib/ai-quota';
import { describeQuestion, trackBackgroundTask } from '@/lib/background-tasks';
import { getAppTimeZone } from '@/lib/config';
import { needsQuestionGradeRecognition, resolveQuestionGrade } from '@/lib/question/question-grade';
import type { QuestionGradeProfile } from '@/lib/question/question-grade';
import type { QuestionSaveFailure } from '@/lib/question/question-save-failure';
import { classifyQuestionSaveError } from '@/lib/question/question-save-failure';

interface ImportGradeUser extends QuestionGradeProfile {
    id: string;
    role?: string | null;
}

interface ImportGradeInput {
    questionText?: string | null;
    gradeSemester?: string | null;
    recognizedGradeSemester?: string | null;
}

type ImportGradeResult =
    | { ok: true; gradeSemester: string | null }
    | { ok: false; failure: QuestionSaveFailure };

/** 把额度超限的 HTTP 响应转换为领域失败结果（状态码、错误码与响应一致）。 */
async function quotaFailure(limited: NonNullable<Awaited<ReturnType<typeof consumeAiQuota>>>): Promise<ImportGradeResult> {
    const body = await limited.json().catch(() => null) as { message?: unknown; code?: unknown; details?: unknown } | null;
    return {
        ok: false,
        failure: {
            code: body?.message === 'AI_DAILY_LIMIT_EXCEEDED' || body?.message === 'AI_CONSENT_REQUIRED' ? body.message : 'QUESTION_SAVE_GRADE_FAILED',
            stage: 'grade',
            status: limited.status,
            errorCode: typeof body?.code === 'string' ? body.code as QuestionSaveFailure['errorCode'] : 'AI_ERROR',
            details: body?.details,
        },
    };
}

/** 在数据库事务外补充年级识别；重复题不调用 AI，也不消耗额度。 */
export async function prepareImportGrade(user: ImportGradeUser, input: ImportGradeInput, duplicate: boolean): Promise<ImportGradeResult> {
    const timeZone = getAppTimeZone();
    if (duplicate || !needsQuestionGradeRecognition(user, input)) {
        return { ok: true, gradeSemester: resolveQuestionGrade(user, input, timeZone) };
    }
    try {
        const limited = await consumeAiQuota(user, 'analyze');
        if (limited) return await quotaFailure(limited);
        const recognizedGradeSemester = await trackBackgroundTask(
            { userId: user.id, kind: 'analyze', subject: describeQuestion({ questionText: input.questionText }) },
            () => getAIService().recognizeGrade(input.questionText ?? ''),
        );
        return { ok: true, gradeSemester: resolveQuestionGrade(user, { ...input, recognizedGradeSemester }, timeZone) };
    } catch (error) {
        return { ok: false, failure: classifyQuestionSaveError(error, 'grade') };
    }
}
