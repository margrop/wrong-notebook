import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { unauthorized, internalError, badRequest, forbidden } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import { startBackgroundTask } from "@/lib/background-tasks";
import type { BackgroundTaskHandle } from "@/lib/background-tasks";
import { generateUniqueShortId, isShortId } from "@/lib/short-id";
import { isPracticeResult, scheduleMasteryEvaluation, syncMasteryLevels } from "@/lib/mastery";
import { MAX_MASTERY_THRESHOLD, MIN_MASTERY_THRESHOLD } from "@/lib/mastery-status";
import { THEME_PREFERENCES } from "@/lib/theme";
import { GRADE_RECOGNITION_MODES } from "@/lib/question-grade";
import { GRADE_SEMESTERS } from "@/lib/grade-options";
import { findDuplicateQuestion, recordDuplicateQuestion } from "@/lib/question-deduplication";
import { parseDifficultyStars } from "@/lib/ai/schema";
import { resolveNotebookScope } from "@/lib/notebook-scope";
import { sortTagsByParent } from "@/lib/tag-hierarchy";
import { sanitizeFigureSvg } from "@/lib/figure-svg";
import { normalizeFigureAlign, normalizeFigureScale } from "@/lib/figure-scale";
import { normalizeCustomAnswerSpacePx } from "@/lib/exam-answer-space";
import { sanitizeSvgAnimation } from "@/lib/svg-animation";
import { importSpeeches } from "@/lib/tts/speech-cache";
import { parseLastPractice } from "@/lib/last-practice";
import { getDefaultPaperLevelGroupId, ensureDefaultPaperGroups } from "@/lib/paper-level";
import { EXAM_DIFFICULTIES, EXAM_SCOPES, summarizePaperStatus } from "@/lib/exam";
import type { Prisma } from "@prisma/client";

const logger = createLogger('api:import');

interface ImportData {
    version: number;
    exportedAt: string;
    scope?: string;
    user: {
        id: string;
        email: string;
        name: string | null;
        educationStage: string | null;
        enrollmentYear: number | null;
        role: string;
        // version 2 起导出的偏好设置
        confirmBeforeImport?: boolean;
        gradeRecognitionMode?: string;
        fixedGradeSemester?: string | null;
        questionDuplicateThreshold?: number;
        masteryThreshold?: number;
        enableGeogebra?: boolean;
        enableSvgAnimation?: boolean;
        themePreference?: string;
    };
    subjects: Array<{
        id: string;
        name: string;
        stage?: string | null;      // 旧版导出文件没有
        subjectKey?: string | null; // 旧版导出文件没有
        tagSet?: string;            // 旧版导出文件没有，缺省 default
        userId: string;
        createdAt: string;
        updatedAt: string;
    }>;
    systemTags?: Array<{ // version 3 起导出
        id: string;
        name: string;
        subject: string;
        parentId: string | null;
        order: number;
        code: string | null;
        isSystem: boolean;
        tagSet: string;
        createdAt: string;
        updatedAt: string;
    }>;
    customTags: Array<{
        id: string;
        name: string;
        subject: string;
        parentId: string | null;
        order: number;
        code: string | null;
        isSystem: boolean;
        tagSet?: string;            // 旧版导出文件没有，缺省 default
        userId: string;
        createdAt: string;
        updatedAt: string;
    }>;
    errorItems: Array<{
        id: string;
        shortId?: string | null;
        userId: string;
        subjectId: string | null;
        originalImageUrl: string;
        ocrText: string | null;
        questionText: string | null;
        answerText: string | null;
        analysis: string | null;
        wrongAnswerText: string | null;
        mistakeAnalysis: string | null;
        mistakeStatus: string | null;
        knowledgePoints: string | null;
        source: string | null;
        errorType: string | null;
        userNotes: string | null;
        masteryLevel: number;
        gradeSemester: string | null;
        paperLevel: string | null;
        difficultyStars?: number | null; // 旧版导出文件没有该字段
        hasFigure?: boolean;             // 旧版导出文件没有该字段
        figureSvg?: string | null;       // 旧版导出文件没有该字段
        figureScale?: number;           // 旧版备份缺省为 100%
        figureAlign?: string;           // 旧版备份缺省为居中
        answerSpacePx?: number | null;  // version 4 起导出，旧版备份缺省为按全局留白档位
        // 以下字段 version 2 起导入，version 1 文件中即使有也按同样规则处理
        geogebraCommands?: string | null;
        svgAnimation?: string | null;
        svgAnimationEn?: string | null;
        lastPractice?: string | null;
        masteryProbability?: number | null;
        masteryReason?: string | null;
        masterySource?: string | null;
        masteryEvaluatedAt?: string | null;
        createdAt: string;
        updatedAt: string;
        tags: Array<{ id: string; name: string; subject: string }>;
    }>;
    reviewSchedules: Array<{
        id: string;
        errorItemId: string;
        scheduledFor: string;
        completedAt: string | null;
        isCorrect: boolean | null;
        createdAt: string;
    }>;
    practiceRecords: Array<{
        id: string;
        userId: string;
        subject: string | null;
        difficulty: string | null;
        isCorrect: boolean | null;
        errorItemId?: string | null;
        result?: string | null;
        questionText?: string | null;
        answerText?: string | null;
        analysis?: string | null;
        wrongAnswerText?: string | null;
        mistakeAnalysis?: string | null;
        originalImageUrl?: string | null;
        figureSvg?: string | null;
        source?: string;
        examQuestionId?: string | null;
        createdAt: string;
    }>;
    examPapers?: Array<{ // version 2 起导出
        id: string;
        userId: string;
        title: string;
        status: string;
        scope: string;
        difficulty: string;
        requestedCount: number;
        subjectIds: string;
        tagNames: string | null;
        resultsRecordedAt: string | null;
        createdAt: string;
        updatedAt: string;
        questions: Array<{
            id: string;
            order: number;
            errorItemId: string | null;
            sourceShortId: string;
            status: string;
            questionText: string | null;
            answerText: string | null;
            analysis: string | null;
            figureSvg: string | null;
            figureScale?: number;           // 旧版备份缺省为 100%
            figureAlign?: string;           // 旧版备份缺省为居中
            answerSpacePx?: number | null;  // version 4 起导出，旧版备份缺省为按全局留白档位
            error: string | null;
        }>;
    }>;
    /** 卷别分组，version 3 起导出 */
    paperGroups?: Array<{
        id: string;
        userId: string;
        key: string | null;
        name: string;
        order: number;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
    }>;
    /** 动画讲解的云端语音（服务商、模型、音色、文字与 Base64 编码的 MP3），写入语音缓存 */
    ttsSpeeches?: unknown;
}

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

function parsePreferences(source: ImportData['user']) {
    const preferences: Prisma.UserUpdateInput = {};
    for (const [key, schema] of Object.entries(PREFERENCE_SCHEMAS)) {
        const parsed = schema.safeParse(source[key as keyof typeof PREFERENCE_SCHEMAS]);
        if (parsed.success) Object.assign(preferences, { [key]: parsed.data });
    }
    return preferences;
}

/** Validate and parse a date string, returning undefined if invalid */
function safeParseDate(dateStr: string | undefined | null): Date | undefined {
    if (!dateStr) return undefined;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? undefined : d;
}

/** 掌握概率须在 [0, 1] 内，否则视为未评估 */
function safeMasteryProbability(val: unknown): number | null {
    return typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 1 ? val : null;
}

/** 导入后重新序列化，格式不合法的暂存内容丢弃 */
function safeLastPractice(raw: string | null | undefined): string | null {
    const practice = parseLastPractice(raw);
    return practice ? JSON.stringify(practice) : null;
}

/** 试卷的错题本 ID 为 JSON 数组，导入时换成新 ID，找不到的去掉 */
function mapSubjectIds(raw: string | null | undefined, subjectIdMap: Map<string, string>): string {
    try {
        const ids: unknown = JSON.parse(raw || '[]');
        if (!Array.isArray(ids)) return '[]';
        return JSON.stringify(ids.flatMap((id) => (typeof id === 'string' && subjectIdMap.has(id) ? [subjectIdMap.get(id)!] : [])));
    } catch {
        return '[]';
    }
}

/** Validate masteryLevel is an integer in range [0, 2] */
function safeMasteryLevel(val: unknown): number {
    const n = typeof val === 'number' ? val : parseInt(String(val), 10);
    if (isNaN(n) || n < 0 || n > 2) return 0;
    return n;
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
        return unauthorized("Not authenticated");
    }

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
    });

    if (!user) {
        return unauthorized("User not found");
    }

    const { searchParams } = new URL(req.url);
    const importAll = searchParams.get('all') === 'true';

    // 只有管理员可以导入全部数据
    if (importAll && session.user.role !== 'admin') {
        return forbidden("Admin role required");
    }

    let task: BackgroundTaskHandle | null = null;
    try {
        const contentLength = req.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > 50 * 1024 * 1024) {
            return badRequest("Request body too large (max 50MB)");
        }

        const body = await req.json() as ImportData;

        // 验证数据格式
        if (!body.version || !body.user || !Array.isArray(body.errorItems)) {
            return badRequest("Invalid import data format");
        }

        // 非管理员模式：验证导出数据属于当前用户
        if (!importAll && body.user.email !== user.email) {
            return badRequest("Import data does not belong to current user");
        }

        const stats = {
            subjectsCreated: 0,
            tagsCreated: 0,
            errorItemsCreated: 0,
            reviewSchedulesCreated: 0,
            examPapersCreated: 0,
            preferencesRestored: false,
            practiceRecordsCreated: 0,
            tagsLinked: 0,
            duplicateErrorItems: 0,
            ttsSpeechesImported: 0,
        };
        const masteryIds = new Set<string>();
        // 已带掌握概率导入的新题无需重新评估
        const evaluatedIds = new Set<string>();

        // 使用事务确保数据一致性
        task = startBackgroundTask({ userId: user.id, kind: 'data_import' });
        await prisma.$transaction(async (tx) => {
            // 0. 偏好设置只在导出文件属于当前账户时还原
            const preferences = body.user.email === user.email ? parsePreferences(body.user) : {};
            if (Object.keys(preferences).length > 0) {
                await tx.user.update({ where: { id: user.id }, data: preferences });
                stats.preferencesRestored = true;
            }

            // 1. 导入 subjects
            const subjectIdMap = new Map<string, string>();
            for (const subject of (body.subjects || [])) {
                const targetUserId = importAll ? subject.userId : user.id;
                const existing = await tx.subject.findFirst({
                    where: { name: subject.name, userId: targetUserId },
                });
                if (existing) {
                    subjectIdMap.set(subject.id, existing.id);
                } else {
                    // 旧版导出文件没有学段和学科：学段按小学，学科由名称推断
                    const scope = resolveNotebookScope(subject);
                    const created = await tx.subject.create({
                        data: {
                            name: subject.name,
                            stage: scope.stage,
                            subjectKey: scope.subject,
                            tagSet: subject.tagSet || 'default',
                            userId: targetUserId,
                        },
                    });
                    subjectIdMap.set(subject.id, created.id);
                    stats.subjectsCreated++;
                }
            }

            // 2. 按体系和父节点路径导入，保留不同年级下的同名章节与知识点。
            const systemTagIdMap = new Map<string, string>();
            for (const tag of sortTagsByParent(body.systemTags || [])) {
                const parentId = tag.parentId ? systemTagIdMap.get(tag.parentId) ?? null : null;
                const existing = await tx.knowledgeTag.findFirst({
                    where: {
                        name: tag.name,
                        subject: tag.subject,
                        isSystem: true,
                        tagSet: tag.tagSet || 'default',
                        parentId,
                    },
                });
                if (existing) {
                    systemTagIdMap.set(tag.id, existing.id);
                } else {
                    const created = await tx.knowledgeTag.create({
                        data: {
                            name: tag.name,
                            subject: tag.subject,
                            isSystem: true,
                            tagSet: tag.tagSet || 'default',
                            parentId,
                            order: tag.order || 0,
                            code: tag.code,
                        },
                    });
                    systemTagIdMap.set(tag.id, created.id);
                }
            }

            // 3. 导入 custom tags
            const tagIdMap = new Map<string, string>();
            for (const tag of sortTagsByParent(body.customTags || [])) {
                const targetUserId = importAll ? tag.userId : user.id;
                const tagSet = tag.tagSet || 'default';
                const parentId = tag.parentId ? tagIdMap.get(tag.parentId) ?? systemTagIdMap.get(tag.parentId) ?? null : null;
                const existing = await tx.knowledgeTag.findFirst({
                    where: {
                        name: tag.name,
                        subject: tag.subject,
                        userId: targetUserId,
                        isSystem: false,
                        tagSet,
                        parentId,
                    },
                });
                if (existing) {
                    tagIdMap.set(tag.id, existing.id);
                } else {
                    const created = await tx.knowledgeTag.create({
                        data: {
                            name: tag.name,
                            subject: tag.subject,
                            isSystem: false,
                            userId: targetUserId,
                            tagSet: tag.tagSet || 'default',
                            parentId,
                            order: tag.order || 0,
                            code: tag.code,
                        },
                    });
                    tagIdMap.set(tag.id, created.id);
                    stats.tagsCreated++;
                }
            }

            // 4. 预加载所有需要的 tags（批量查询，避免 N+1）
            // tagSet 映射：subject ID → tagSet，用于错题按错题本 tagSet 匹配系统标签
            const subjectTagSetMap = new Map<string, string>();
            for (const subject of (body.subjects || [])) {
                if (subject.tagSet) {
                    subjectTagSetMap.set(subject.id, subject.tagSet);
                }
            }
            const allTagNames = new Set<string>();
            for (const item of body.errorItems) {
                if (item.tags) {
                    for (const tag of item.tags) {
                        allTagNames.add(tag.name);
                    }
                }
            }
            // 批量查询：系统 tag + 所有用户的自定义 tag
            const preloadedTags = await tx.knowledgeTag.findMany({
                where: {
                    name: { in: Array.from(allTagNames) },
                    OR: [
                        { isSystem: true },
                        ...(importAll ? [] : [{ userId: user.id }]),
                    ],
                },
            });
            // 按 (tagSet, name) 建索引，错题关联时按错题本 tagSet 精确匹配系统标签
            const tagBySetAndName = new Map<string, string>();
            for (const tag of preloadedTags) {
                const key = `${tag.tagSet}::${tag.name}`;
                if (!tagBySetAndName.has(key) || (!importAll && tag.userId === user.id)) {
                    tagBySetAndName.set(key, tag.id);
                }
            }
            // 兼容旧版导出文件：不区分 tagSet 时按名字兜底
            const tagNameMap = new Map<string, string>();
            for (const tag of preloadedTags) {
                if (!tagNameMap.has(tag.name) || (!importAll && tag.userId === user.id)) {
                    tagNameMap.set(tag.name, tag.id);
                }
            }

            // 4. 导入 error items
            const errorItemIdMap = new Map<string, string>();
            const errorItemOwnerMap = new Map<string, string>();

            // 4.0 预导入卷别分组（paperGroups），建立 id 映射
            const paperGroupIdMap = new Map<string, string>();
            for (const group of (body.paperGroups || [])) {
                const targetUserId = importAll ? group.userId : user.id;
                const existing = await tx.paperGroup.findFirst({
                    where: { id: group.id, userId: targetUserId },
                });
                if (existing) {
                    paperGroupIdMap.set(group.id, existing.id);
                } else {
                    // 按 name 匹配，避免重复创建
                    const byName = await tx.paperGroup.findFirst({
                        where: { name: group.name, userId: targetUserId },
                    });
                    if (byName) {
                        paperGroupIdMap.set(group.id, byName.id);
                    } else {
                        const created = await tx.paperGroup.create({
                            data: {
                                userId: targetUserId,
                                key: group.key,
                                name: group.name,
                                order: group.order || 0,
                                isActive: group.isActive !== false,
                            },
                        });
                        paperGroupIdMap.set(group.id, created.id);
                    }
                }
            }

            // 兼容旧版备份：为每个有错题的用户确保默认分组存在
            const legacyLevelMap = new Map<string, string>();
            for (const item of body.errorItems) {
                const targetUserId = importAll ? item.userId : user.id;
                if (!legacyLevelMap.has(`${targetUserId}:a`)) {
                    const defaults = await ensureDefaultPaperGroups(targetUserId, tx);
                    legacyLevelMap.set(`${targetUserId}:a`, defaults.a || "");
                    legacyLevelMap.set(`${targetUserId}:b`, defaults.b || "");
                    legacyLevelMap.set(`${targetUserId}:other`, defaults.other || "");
                }
            }

            for (const item of body.errorItems) {
                const targetUserId = importAll ? item.userId : user.id;
                errorItemOwnerMap.set(item.id, targetUserId);
                const newSubjectId = item.subjectId ? subjectIdMap.get(item.subjectId) : undefined;

                const duplicate = await findDuplicateQuestion(tx, targetUserId, item);
                if (duplicate) {
                    const existing = await recordDuplicateQuestion(tx, targetUserId, duplicate, item);
                    // 后续复习计划和练习历史映射到原题，保留本次导入的错误快照。
                    errorItemIdMap.set(item.id, existing.id);
                    masteryIds.add(existing.id);
                    stats.duplicateErrorItems++;
                    stats.practiceRecordsCreated++;
                    continue;
                }

                // 尽量保留导出数据中的短 ID，冲突时重新生成
                const keepShortId = isShortId(item.shortId)
                    && !(await tx.errorItem.findUnique({ where: { shortId: item.shortId }, select: { id: true } }));
                const difficultyStars = parseDifficultyStars(item.difficultyStars);
                const masteryProbability = safeMasteryProbability(item.masteryProbability);
                const masteryEvaluatedAt = masteryProbability === null ? undefined : safeParseDate(item.masteryEvaluatedAt);

                // 解析 paperLevel：优先查 paperGroupIdMap，其次查 legacyLevelMap，最后按星级推荐
                let resolvedPaperLevel: string | null = null;
                const rawPaperLevel = item.paperLevel;
                if (rawPaperLevel) {
                    if (paperGroupIdMap.has(rawPaperLevel)) {
                        resolvedPaperLevel = paperGroupIdMap.get(rawPaperLevel)!;
                    } else if (legacyLevelMap.has(`${targetUserId}:${rawPaperLevel}`)) {
                        resolvedPaperLevel = legacyLevelMap.get(`${targetUserId}:${rawPaperLevel}`) || null;
                    } else {
                        // 尝试按 id 直接查（同用户）
                        const direct = await tx.paperGroup.findFirst({
                            where: { id: rawPaperLevel, userId: targetUserId },
                        });
                        resolvedPaperLevel = direct?.id || null;
                    }
                }
                if (!resolvedPaperLevel && difficultyStars !== null) {
                    resolvedPaperLevel = await getDefaultPaperLevelGroupId(targetUserId, difficultyStars, tx);
                }

                const created = await tx.errorItem.create({
                    data: {
                        shortId: keepShortId ? item.shortId : await generateUniqueShortId(tx),
                        userId: targetUserId,
                        subjectId: newSubjectId || undefined,
                        originalImageUrl: item.originalImageUrl || '',
                        ocrText: item.ocrText,
                        questionText: item.questionText,
                        answerText: item.answerText,
                        analysis: item.analysis,
                        wrongAnswerText: item.wrongAnswerText,
                        mistakeAnalysis: item.mistakeAnalysis,
                        mistakeStatus: item.mistakeStatus,
                        knowledgePoints: item.knowledgePoints,
                        source: item.source,
                        errorType: item.errorType,
                        userNotes: item.userNotes,
                        masteryLevel: safeMasteryLevel(item.masteryLevel),
                        gradeSemester: item.gradeSemester,
                        paperLevel: resolvedPaperLevel,
                        difficultyStars,
                        hasFigure: item.hasFigure === true || sanitizeFigureSvg(item.figureSvg) !== null,
                        figureSvg: sanitizeFigureSvg(item.figureSvg),
                        figureScale: normalizeFigureScale(item.figureScale),
                        figureAlign: normalizeFigureAlign(item.figureAlign),
                        answerSpacePx: normalizeCustomAnswerSpacePx(item.answerSpacePx),
                        geogebraCommands: typeof item.geogebraCommands === 'string' && item.geogebraCommands ? item.geogebraCommands : null,
                        svgAnimation: sanitizeSvgAnimation(item.svgAnimation),
                        svgAnimationEn: sanitizeSvgAnimation(item.svgAnimationEn),
                        lastPractice: safeLastPractice(item.lastPractice),
                        // 掌握概率与评估时间成对保留，缺任一项则导入后重新评估
                        ...(masteryProbability !== null && masteryEvaluatedAt ? {
                            masteryProbability,
                            masteryReason: item.masteryReason ?? null,
                            masterySource: item.masterySource === 'ai' || item.masterySource === 'rule' ? item.masterySource : null,
                            masteryEvaluatedAt,
                        } : {}),
                        createdAt: safeParseDate(item.createdAt),
                        updatedAt: safeParseDate(item.updatedAt),
                    },
                });
                errorItemIdMap.set(item.id, created.id);
                if (created.masteryEvaluatedAt) evaluatedIds.add(created.id);
                stats.errorItemsCreated++;

                // 关联 tags：优先按备份 ID 还原具体节点，旧备份再按体系和名字兜底。
                if (item.tags && item.tags.length > 0) {
                    const itemTagSet = (item.subjectId && subjectTagSetMap.get(item.subjectId)) || 'default';
                    const tagConnections: { id: string }[] = [];
                    for (const tag of item.tags) {
                        if (tagIdMap.has(tag.id)) {
                            tagConnections.push({ id: tagIdMap.get(tag.id)! });
                        } else if (systemTagIdMap.has(tag.id)) {
                            tagConnections.push({ id: systemTagIdMap.get(tag.id)! });
                        } else {
                            const bySet = tagBySetAndName.get(`${itemTagSet}::${tag.name}`);
                            const byName = tagNameMap.get(tag.name);
                            const matched = bySet || byName;
                            if (matched) {
                                tagConnections.push({ id: matched });
                            }
                        }
                    }

                    if (tagConnections.length > 0) {
                        await tx.errorItem.update({
                            where: { id: created.id },
                            data: {
                                tags: { connect: tagConnections },
                            },
                        });
                        stats.tagsLinked += tagConnections.length;
                    }
                }
            }

            // 5. 导入 review schedules
            for (const schedule of (body.reviewSchedules || [])) {
                const newErrorItemId = errorItemIdMap.get(schedule.errorItemId);
                if (newErrorItemId) {
                    const scheduledFor = safeParseDate(schedule.scheduledFor);
                    if (scheduledFor) {
                        // 去重：同一 errorItem + 相同 scheduledFor 视为重复
                        const existingSchedule = await tx.reviewSchedule.findFirst({
                            where: {
                                errorItemId: newErrorItemId,
                                scheduledFor,
                            },
                        });
                        if (existingSchedule) continue;

                        await tx.reviewSchedule.create({
                            data: {
                                errorItemId: newErrorItemId,
                                scheduledFor,
                                completedAt: safeParseDate(schedule.completedAt),
                                isCorrect: schedule.isCorrect,
                            },
                        });
                        stats.reviewSchedulesCreated++;
                    }
                }
            }

            // 6. 导入试卷：同一用户下标题和创建时间都相同视为已导入过，只建立题目映射
            const examQuestionIdMap = new Map<string, string>();
            const examQuestionOwnerMap = new Map<string, string>();
            for (const paper of (body.examPapers || [])) {
                const targetUserId = importAll ? paper.userId : user.id;
                const questions = Array.isArray(paper.questions) ? paper.questions : [];
                const createdAt = safeParseDate(paper.createdAt);
                const existing = createdAt && await tx.examPaper.findFirst({
                    where: { userId: targetUserId, title: paper.title, createdAt },
                    select: { questions: { select: { id: true, order: true } } },
                });
                if (existing) {
                    for (const question of questions) {
                        const matched = existing.questions.find((candidate) => candidate.order === question.order);
                        if (matched) {
                            examQuestionIdMap.set(question.id, matched.id);
                            examQuestionOwnerMap.set(question.id, targetUserId);
                        }
                    }
                    continue;
                }

                // 导出时还在生成的题目不会继续生成，按失败处理，可在试卷页重新生成
                const statuses = questions.map((question) => (question.status === 'ready' ? 'ready' : 'failed'));
                const created = await tx.examPaper.create({
                    data: {
                        userId: targetUserId,
                        title: String(paper.title || ''),
                        status: statuses.length > 0 ? summarizePaperStatus(statuses) : 'failed',
                        scope: (EXAM_SCOPES as readonly string[]).includes(paper.scope) ? paper.scope : 'all',
                        difficulty: (EXAM_DIFFICULTIES as readonly string[]).includes(paper.difficulty) ? paper.difficulty : 'medium',
                        requestedCount: Number.isInteger(paper.requestedCount) && paper.requestedCount > 0 ? paper.requestedCount : questions.length,
                        subjectIds: mapSubjectIds(paper.subjectIds, subjectIdMap),
                        tagNames: typeof paper.tagNames === 'string' ? paper.tagNames : null,
                        resultsRecordedAt: safeParseDate(paper.resultsRecordedAt),
                        createdAt,
                        updatedAt: safeParseDate(paper.updatedAt),
                    },
                });
                for (const [index, question] of questions.entries()) {
                    const errorItemId = question.errorItemId && errorItemOwnerMap.get(question.errorItemId) === targetUserId
                        ? errorItemIdMap.get(question.errorItemId) : undefined;
                    const createdQuestion = await tx.examQuestion.create({
                        data: {
                            paperId: created.id,
                            order: Number.isInteger(question.order) ? question.order : index,
                            errorItemId,
                            sourceShortId: String(question.sourceShortId || ''),
                            status: statuses[index],
                            questionText: question.questionText,
                            answerText: question.answerText,
                            analysis: question.analysis,
                            figureSvg: sanitizeFigureSvg(question.figureSvg),
                            figureScale: normalizeFigureScale(question.figureScale),
                            figureAlign: normalizeFigureAlign(question.figureAlign),
                            answerSpacePx: normalizeCustomAnswerSpacePx(question.answerSpacePx),
                            error: question.error,
                        },
                    });
                    examQuestionIdMap.set(question.id, createdQuestion.id);
                    examQuestionOwnerMap.set(question.id, targetUserId);
                }
                stats.examPapersCreated++;
            }

            // 7. 导入 practice records
            for (const record of (body.practiceRecords || [])) {
                const targetUserId = importAll ? record.userId : user.id;
                const errorItemId = record.errorItemId && errorItemOwnerMap.get(record.errorItemId) === targetUserId
                    ? errorItemIdMap.get(record.errorItemId) : undefined;
                const result = isPracticeResult(record.result) ? record.result : undefined;
                const examQuestionId = record.examQuestionId && examQuestionOwnerMap.get(record.examQuestionId) === targetUserId
                    ? examQuestionIdMap.get(record.examQuestionId) : undefined;
                await tx.practiceRecord.create({
                    data: {
                        userId: targetUserId,
                        subject: record.subject,
                        difficulty: record.difficulty,
                        isCorrect: record.isCorrect,
                        ...(errorItemId ? {
                            errorItemId,
                            result,
                            questionText: record.questionText,
                            answerText: record.answerText,
                            analysis: record.analysis,
                            wrongAnswerText: record.wrongAnswerText,
                            mistakeAnalysis: record.mistakeAnalysis,
                            originalImageUrl: record.originalImageUrl,
                            figureSvg: sanitizeFigureSvg(record.figureSvg),
                            source: ['practice', 'manual', 'exam', 'duplicate_import'].includes(record.source || '') ? record.source : 'practice',
                            examQuestionId,
                        } : {}),
                        createdAt: safeParseDate(record.createdAt),
                    },
                });
                stats.practiceRecordsCreated++;
                if (errorItemId && result && !evaluatedIds.has(errorItemId)) masteryIds.add(errorItemId);
            }

            // 8. 还原了已掌握阈值时，按新阈值同步该账户全部错题的 masteryLevel
            if (typeof preferences.masteryThreshold === 'number') {
                await syncMasteryLevels(tx, user.id, preferences.masteryThreshold);
            }
        }, {
            timeout: 60000,
        });

        if (masteryIds.size) scheduleMasteryEvaluation([...masteryIds]);
        // 语音缓存不在数据库中，数据导入成功后再写入；失败只记录日志，不影响已导入的数据
        stats.ttsSpeechesImported = await importSpeeches(body.ttsSpeeches).catch((error: unknown) => {
            logger.warn({ error }, 'Failed to import TTS speeches');
            return 0;
        });
        task.succeed();

        logger.info({
            userId: user.id,
            scope: importAll ? 'all' : 'user',
            ...stats,
        }, 'Data import completed');

        return NextResponse.json({
            success: true,
            stats,
        });
    } catch (error) {
        task?.fail(error);
        logger.error({ error, userId: user.id }, 'Import failed');
        return internalError("Failed to import data");
    }
}
