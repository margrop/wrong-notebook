/**
 * 备份导入的纯函数预处理：把 parseBackupFile 的结果按版本补默认值、
 * 规范化日期、数值与偏好设置，输出供 import-writer 直接写入的结构。
 * 不依赖 prisma，可独立测试。
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type {
    ImportableBackupFile,
    ImportedBackupErrorItem,
    ImportedBackupExamPaper,
    ImportedBackupPracticeRecord,
    ImportedBackupReviewSchedule,
} from "@/lib/backup/format";
import { parseLastPractice } from "@/lib/last-practice";
import { MAX_MASTERY_THRESHOLD, MIN_MASTERY_THRESHOLD } from "@/lib/mastery-status";
import { THEME_PREFERENCES } from "@/lib/theme";
import { GRADE_RECOGNITION_MODES } from "@/lib/question/question-grade";
import { GRADE_SEMESTERS } from "@/lib/grade-options";
import { parseDifficultyStars } from "@/lib/ai/schema";
import { sanitizeFigureSvg } from "@/lib/figure-svg";
import { normalizeFigureAlign, normalizeFigureScale } from "@/lib/figure-scale";
import { normalizeCustomAnswerSpacePx } from "@/lib/exam/exam-answer-space";
import { sanitizeSvgAnimation } from "@/lib/svg-animation";
import { EXAM_DIFFICULTIES, EXAM_MODES, EXAM_SCOPES } from "@/lib/exam/exam";
import { isPracticeResult } from "@/lib/mastery";

export type ImportData = ImportableBackupFile;

// 与用户设置接口的取值范围一致，单项不合法时只跳过该项
const PREFERENCE_SCHEMAS = {
    gradeRecognitionMode: z.enum(GRADE_RECOGNITION_MODES),
    fixedGradeSemester: z.enum(GRADE_SEMESTERS).nullable(),
    confirmBeforeImport: z.boolean(),
    questionDuplicateThreshold: z.number().min(1).max(100),
    masteryThreshold: z.number().int().min(MIN_MASTERY_THRESHOLD).max(MAX_MASTERY_THRESHOLD),
    enableGeogebra: z.boolean(),
    enableSvgAnimation: z.boolean(),
    themePreference: z.enum(THEME_PREFERENCES),
};

/** Validate and parse a date string, returning undefined if invalid */
export function safeParseDate(dateStr: string | undefined | null): Date | undefined {
    if (!dateStr) return undefined;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? undefined : d;
}

/** 掌握概率须在 [0, 1] 内，否则视为未评估 */
export function safeMasteryProbability(val: unknown): number | null {
    return typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 1 ? val : null;
}

/** 导入后重新序列化，格式不合法的暂存内容丢弃 */
export function safeLastPractice(raw: string | null | undefined): string | null {
    const practice = parseLastPractice(raw);
    return practice ? JSON.stringify(practice) : null;
}

/** 试卷的错题本 ID 为 JSON 数组，导入时换成新 ID，找不到的去掉 */
export function mapSubjectIds(raw: string | null | undefined, subjectIdMap: Map<string, string>): string {
    try {
        const ids: unknown = JSON.parse(raw || '[]');
        if (!Array.isArray(ids)) return '[]';
        return JSON.stringify(ids.flatMap((id) => (typeof id === 'string' && subjectIdMap.has(id) ? [subjectIdMap.get(id)!] : [])));
    } catch {
        return '[]';
    }
}

/** Validate masteryLevel is an integer in range [0, 2] */
export function safeMasteryLevel(val: unknown): number {
    const n = typeof val === 'number' ? val : parseInt(String(val), 10);
    if (isNaN(n) || n < 0 || n > 2) return 0;
    return n;
}

/** 规范化的错题：日期与数值字段已转为可写库的形态 */
export interface NormalizedErrorItem {
    raw: ImportedBackupErrorItem;
    masteryProbability: number | null;
    masteryEvaluatedAt: Date | undefined;
    difficultyStars: number | null;
    masteryLevel: number;
    hasFigure: boolean;
    figureSvg: string | null;
    figureScale: number;
    figureAlign: ReturnType<typeof normalizeFigureAlign>;
    answerSpacePx: number | null;
    geogebraCommands: string | null;
    svgAnimation: string | null;
    svgAnimationEn: string | null;
    lastPractice: string | null;
    createdAt: Date | undefined;
    updatedAt: Date | undefined;
}

/** 规范化的试卷：枚举与日期字段已按导入侧取值 */
export interface NormalizedExamPaper {
    raw: ImportedBackupExamPaper;
    createdAt: Date | undefined;
    updatedAt: Date | undefined;
    resultsRecordedAt: Date | undefined;
    scope: string;
    mode: string;
    difficulty: string;
    requestedCount: number;
    tagNames: string | null;
    statuses: string[];
}

/** 规范化的复习计划 */
export interface NormalizedReviewSchedule {
    raw: ImportedBackupReviewSchedule;
    scheduledFor: Date | undefined;
    completedAt: Date | undefined;
}

/** 规范化的练习记录 */
export interface NormalizedPracticeRecord {
    raw: ImportedBackupPracticeRecord;
    result: 'correct' | 'wrong' | 'not_attempted' | undefined;
    createdAt: Date | undefined;
    source: string;
}

/** 规范化后的导入数据：import-writer 直接据此写库 */
export interface NormalizedImportData {
    data: ImportData;
    /** 仅当导出文件属于当前账户时才有内容 */
    preferences: Prisma.UserUpdateInput;
    hasPreferences: boolean;
    subjects: NonNullable<ImportData['subjects']>;
    systemTags: NonNullable<ImportData['systemTags']>;
    customTags: NonNullable<ImportData['customTags']>;
    errorItems: NormalizedErrorItem[];
    reviewSchedules: NormalizedReviewSchedule[];
    practiceRecords: NormalizedPracticeRecord[];
    examPapers: NormalizedExamPaper[];
    paperGroups: NonNullable<ImportData['paperGroups']>;
}

function normalizeErrorItem(item: ImportedBackupErrorItem): NormalizedErrorItem {
    const masteryProbability = safeMasteryProbability(item.masteryProbability);
    const masteryEvaluatedAt = masteryProbability === null ? undefined : safeParseDate(item.masteryEvaluatedAt);
    const figureSvg = sanitizeFigureSvg(item.figureSvg);
    return {
        raw: item,
        masteryProbability,
        masteryEvaluatedAt,
        difficultyStars: parseDifficultyStars(item.difficultyStars),
        masteryLevel: safeMasteryLevel(item.masteryLevel),
        hasFigure: item.hasFigure === true || figureSvg !== null,
        figureSvg,
        figureScale: normalizeFigureScale(item.figureScale),
        figureAlign: normalizeFigureAlign(item.figureAlign),
        answerSpacePx: normalizeCustomAnswerSpacePx(item.answerSpacePx),
        geogebraCommands: typeof item.geogebraCommands === 'string' && item.geogebraCommands ? item.geogebraCommands : null,
        svgAnimation: sanitizeSvgAnimation(item.svgAnimation),
        svgAnimationEn: sanitizeSvgAnimation(item.svgAnimationEn),
        lastPractice: safeLastPractice(item.lastPractice),
        createdAt: safeParseDate(item.createdAt),
        updatedAt: safeParseDate(item.updatedAt),
    };
}

function normalizeExamPaper(paper: ImportedBackupExamPaper): NormalizedExamPaper {
    const questions = Array.isArray(paper.questions) ? paper.questions : [];
    const mode = (EXAM_MODES as readonly string[]).includes(paper.mode || '') ? paper.mode! : 'generate';
    return {
        raw: paper,
        createdAt: safeParseDate(paper.createdAt),
        updatedAt: safeParseDate(paper.updatedAt),
        resultsRecordedAt: safeParseDate(paper.resultsRecordedAt),
        scope: (EXAM_SCOPES as readonly string[]).includes(paper.scope) ? paper.scope : 'all',
        // 原题直出模式没有 AI 生成难度；旧版文件缺省 generate
        mode,
        difficulty: mode === 'original'
            ? 'original'
            : (EXAM_DIFFICULTIES as readonly string[]).includes(paper.difficulty) ? paper.difficulty : 'medium',
        requestedCount: Number.isInteger(paper.requestedCount) && paper.requestedCount > 0 ? paper.requestedCount : questions.length,
        tagNames: typeof paper.tagNames === 'string' ? paper.tagNames : null,
        // 导出时还在生成的题目不会继续生成，按失败处理，可在试卷页重新生成
        statuses: questions.map((question) => (question.status === 'ready' ? 'ready' : 'failed')),
    };
}

function normalizePracticeRecord(record: ImportedBackupPracticeRecord): NormalizedPracticeRecord {
    return {
        raw: record,
        result: isPracticeResult(record.result) ? record.result : undefined,
        createdAt: safeParseDate(record.createdAt),
        source: ['practice', 'manual', 'exam', 'duplicate_import'].includes(record.source || '') ? record.source! : 'practice',
    };
}

/** 解析用户偏好设置：逐项校验，不合法的单项跳过 */
export function parsePreferences(source: ImportData['user']): Prisma.UserUpdateInput {
    const preferences: Prisma.UserUpdateInput = {};
    for (const [key, schema] of Object.entries(PREFERENCE_SCHEMAS)) {
        const parsed = schema.safeParse(source[key as keyof typeof PREFERENCE_SCHEMAS]);
        if (parsed.success) Object.assign(preferences, { [key]: parsed.data });
    }
    return preferences;
}

/**
 * 把 parseBackupFile 的结果规范化为可写库的结构。
 * belongsToCurrentUser 为 true 时解析偏好设置，否则偏好设置留空。
 */
export function normalizeBackupForImport(body: ImportData, belongsToCurrentUser: boolean): NormalizedImportData {
    // 偏好设置只在导出文件属于当前账户时还原
    const preferences = belongsToCurrentUser ? parsePreferences(body.user) : {};
    return {
        data: body,
        preferences,
        hasPreferences: Object.keys(preferences).length > 0,
        subjects: body.subjects ?? [],
        systemTags: body.systemTags ?? [],
        customTags: body.customTags ?? [],
        errorItems: body.errorItems.map(normalizeErrorItem),
        reviewSchedules: (body.reviewSchedules ?? []).map((schedule) => ({
            raw: schedule,
            scheduledFor: safeParseDate(schedule.scheduledFor),
            completedAt: safeParseDate(schedule.completedAt),
        })),
        practiceRecords: (body.practiceRecords ?? []).map(normalizePracticeRecord),
        examPapers: (body.examPapers ?? []).map(normalizeExamPaper),
        paperGroups: body.paperGroups ?? [],
    };
}
