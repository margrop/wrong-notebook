import { DEFAULT_TIME_ZONE } from '@/lib/date-time';
import { calculateGrade } from '@/lib/grade-calculator';
import { GRADE_NAMES, GRADE_SEMESTERS } from '@/lib/grade-options';
import type { GradeLevel } from '@/lib/ai/types';

export const GRADE_RECOGNITION_MODES = ['fixed', 'ai'] as const;
export type GradeRecognitionMode = typeof GRADE_RECOGNITION_MODES[number];

export interface QuestionGradeProfile {
    gradeRecognitionMode?: string;
    fixedGradeSemester?: string | null;
    educationStage?: string | null;
    enrollmentYear?: number | null;
}

/** 只接收清单中的 AI 年级，缺失或无法确定时保持未设置。 */
export function parseRecognizedGrade(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const grade = value.trim();
    return GRADE_SEMESTERS.includes(grade) ? grade : null;
}

/** 旧账户默认沿用根据账户资料计算年级的行为；指定的固定年级不会随学年变化。 */
export function getFixedQuestionGrade(profile: QuestionGradeProfile, timeZone = DEFAULT_TIME_ZONE): string | null {
    if (profile.gradeRecognitionMode === 'ai') return null;
    if (profile.fixedGradeSemester) return profile.fixedGradeSemester;
    if (!profile.educationStage || !profile.enrollmentYear) return null;
    return calculateGrade(profile.educationStage, profile.enrollmentYear, new Date(), 'zh', timeZone);
}

/** 固定年级同时用于知识点范围和解题方法约束，AI 模式不传学生当前年级。 */
export function getQuestionGradeContext(profile: QuestionGradeProfile, timeZone = DEFAULT_TIME_ZONE) {
    const gradeSemester = getFixedQuestionGrade(profile, timeZone);
    const index = gradeSemester ? GRADE_NAMES.findIndex((name) => gradeSemester.startsWith(name)) : -1;
    const grade: GradeLevel | null = index >= 0 && index < 12 ? (index + 1) as GradeLevel : null;
    return { grade, gradeSemester };
}

/** 手工选择优先，其次应用用户规则；AI 结果缺失时不回填学生当前年级。 */
export function resolveQuestionGrade(
    profile: QuestionGradeProfile,
    input: { gradeSemester?: string | null; recognizedGradeSemester?: string | null },
    timeZone = DEFAULT_TIME_ZONE,
): string | null {
    if (input.gradeSemester !== undefined) return input.gradeSemester?.trim() || null;
    return profile.gradeRecognitionMode === 'ai'
        ? parseRecognizedGrade(input.recognizedGradeSemester)
        : getFixedQuestionGrade(profile, timeZone);
}

/** null 表示已经尝试识别但无法确定，只有完全缺少识别字段时才补充请求。 */
export function needsQuestionGradeRecognition(
    profile: QuestionGradeProfile,
    input: { gradeSemester?: string | null; recognizedGradeSemester?: string | null; questionText?: string | null },
): boolean {
    return profile.gradeRecognitionMode === 'ai' && input.gradeSemester === undefined
        && input.recognizedGradeSemester === undefined && !!input.questionText?.trim();
}
