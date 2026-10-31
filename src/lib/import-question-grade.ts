import type { NextResponse } from 'next/server';
import { getAIService } from '@/lib/ai';
import { consumeAiQuota } from '@/lib/ai-quota';
import { describeQuestion, trackBackgroundTask } from '@/lib/background-tasks';
import { getAppTimeZone } from '@/lib/config';
import { needsQuestionGradeRecognition, resolveQuestionGrade } from '@/lib/question-grade';
import type { QuestionGradeProfile } from '@/lib/question-grade';

interface ImportGradeUser extends QuestionGradeProfile {
    id: string;
    role?: string | null;
}

interface ImportGradeInput {
    questionText?: string | null;
    gradeSemester?: string | null;
    recognizedGradeSemester?: string | null;
}

type ImportGradeResult = { gradeSemester: string | null; response?: never } | { response: NextResponse; gradeSemester?: never };

/** 在数据库事务外补充年级识别；重复题不调用 AI，也不消耗额度。 */
export async function prepareImportGrade(user: ImportGradeUser, input: ImportGradeInput, duplicate: boolean): Promise<ImportGradeResult> {
    const timeZone = getAppTimeZone();
    if (duplicate || !needsQuestionGradeRecognition(user, input)) {
        return { gradeSemester: resolveQuestionGrade(user, input, timeZone) };
    }
    const limited = await consumeAiQuota(user, 'analyze');
    if (limited) return { response: limited };
    const recognizedGradeSemester = await trackBackgroundTask(
        { userId: user.id, kind: 'analyze', subject: describeQuestion({ questionText: input.questionText }) },
        () => getAIService().recognizeGrade(input.questionText ?? ''),
    );
    return { gradeSemester: resolveQuestionGrade(user, { ...input, recognizedGradeSemester }, timeZone) };
}
