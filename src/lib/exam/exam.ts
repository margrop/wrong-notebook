import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getAIService } from "@/lib/ai";
import type { DifficultyLevel } from "@/lib/ai/types";
import { createLogger } from "@/lib/logger";
import { getMasteryThreshold } from "@/lib/mastery";
import { DEFAULT_MASTERY_THRESHOLD, masteryStatusWhere } from "@/lib/mastery-status";
import { runReservedTask, startBackgroundTask } from "@/lib/background-tasks";
import { resolveNotebookScope, SUBJECT_DISPLAY_NAMES } from "@/lib/notebook-scope";
import { QUESTION_TYPES } from "@/lib/question/question-type";
import type { BackgroundTaskHandle } from "@/lib/background-tasks";

const logger = createLogger('exam');

export const EXAM_SCOPES = ['unmastered', 'mastered', 'all'] as const;
export type ExamScope = typeof EXAM_SCOPES[number];
export const EXAM_DIFFICULTIES = ['easy', 'medium', 'hard', 'harder'] as const;
/** 组卷模式：generate 举一反三新题（默认）/ original 原题直出 */
export const EXAM_MODES = ['generate', 'original'] as const;
export type ExamMode = typeof EXAM_MODES[number];
/** 抽题规则：优先练习较少的题目（默认）/ 完全随机 */
export const EXAM_PICK_RULES = ['least_practiced', 'random'] as const;
export type ExamPickRule = typeof EXAM_PICK_RULES[number];
export const DEFAULT_EXAM_PICK_RULE: ExamPickRule = 'least_practiced';
export const MAX_EXAM_QUESTIONS = 50;

// 同时生成的题目数
const GENERATION_CONCURRENCY = 3;

export interface ExamSelection {
    subjectIds: string[];
    tagNames?: string[];
    paperLevelIds?: string[];
    /** 题型多选过滤：标准题型 key，"none" 表示未设置题型；缺省/空数组不限制 */
    questionTypes?: string[];
    scope: ExamScope;
    count: number;
    pickRule?: ExamPickRule;
    /** 原题直出模式要求题目必须有题干文字 */
    requireQuestionText?: boolean;
    /** 选题来源 key，缺省为默认错题本来源（见 exam-sources.ts 的 DEFAULT_EXAM_SOURCE） */
    source?: string;
    /** 排除已选的原题 ID（A/B 卷平行组卷时避免两卷题目重复） */
    excludeIds?: string[];
}

/** 构造抽题条件：限定错题本、掌握范围（按用户的已掌握阈值），可选按知识点标签和卷别分组 */
export function buildSourceWhere(userId: string, selection: ExamSelection, masteryThreshold = DEFAULT_MASTERY_THRESHOLD): Prisma.ErrorItemWhereInput {
    const where: Prisma.ErrorItemWhereInput = {
        userId,
        subjectId: { in: selection.subjectIds },
        shortId: { not: null },
    };
    // 未掌握包括待复习和复习中
    if (selection.scope === 'unmastered') {
        where.NOT = masteryStatusWhere('mastered', masteryThreshold);
    } else if (selection.scope === 'mastered') {
        where.AND = [masteryStatusWhere('mastered', masteryThreshold)];
    }
    if (selection.tagNames && selection.tagNames.length > 0) {
        where.tags = { some: { name: { in: selection.tagNames } } };
    }
    if (selection.paperLevelIds && selection.paperLevelIds.length > 0) {
        where.paperLevel = { in: selection.paperLevelIds };
    }
    // 题型多选：选 "none" 时包含未设置题型的题，与其他已选题型取 OR；未知题型 key 忽略
    if (selection.questionTypes && selection.questionTypes.length > 0) {
        const typeConditions: Prisma.ErrorItemWhereInput[] = [];
        const concreteTypes = selection.questionTypes.filter(
            (value) => value !== 'none' && (QUESTION_TYPES as readonly string[]).includes(value)
        );
        if (concreteTypes.length > 0) {
            typeConditions.push({ questionType: { in: concreteTypes } });
        }
        if (selection.questionTypes.includes('none')) {
            typeConditions.push({ questionType: null });
        }
        if (typeConditions.length > 0) {
            const existingAnd = where.AND;
            const andArray: Prisma.ErrorItemWhereInput[] = Array.isArray(existingAnd) ? [...existingAnd] : existingAnd ? [existingAnd] : [];
            andArray.push({ OR: typeConditions });
            where.AND = andArray;
        }
    }
    // 原题直出模式要求有题干；纯空白无法用 where 判断，在 selectSourceItems 中再过滤
    if (selection.requireQuestionText) {
        where.questionText = { not: null };
    }
    return where;
}

/** Fisher-Yates 洗牌后取前 count 个 */
export function sampleItems<T>(items: T[], count: number, random: () => number = Math.random): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, count);
}

/** 是否已出现在已有试卷中 */
function isInExam(item: { inExam?: boolean; examCount?: number }): number {
    if (typeof item.inExam === 'boolean') return item.inExam ? 1 : 0;
    return (item.examCount ?? 0) > 0 ? 1 : 0;
}

/** 优先抽练习次数少的题；同次数时优先从未进过试卷的题，仍相同时随机（先洗牌再稳定排序） */
export function pickLeastPracticed<T extends { practiceCount: number; inExam?: boolean; examCount?: number }>(items: T[], count: number, random: () => number = Math.random): T[] {
    return sampleItems(items, items.length, random)
        .sort((a, b) => a.practiceCount - b.practiceCount || isInExam(a) - isInExam(b))
        .slice(0, count);
}

/** 按抽题规则选取原题，练习次数为该题的全部举一反三记录数，同次数优先选未出现在已有试卷中的题 */
export async function selectSourceItems(userId: string, selection: ExamSelection) {
    const where = buildSourceWhere(userId, selection, await getMasteryThreshold(userId));
    if (selection.excludeIds && selection.excludeIds.length > 0) {
        where.id = { notIn: selection.excludeIds };
    }
    const candidates = await prisma.errorItem.findMany({
        where,
        // 只有原题直出需要判断题干，其他模式不读取题干全文；题型用于创建试卷题目时快照；难度星级用于 A/B 卷均衡分配
        select: { id: true, shortId: true, questionType: true, difficultyStars: true, questionText: selection.requireQuestionText === true, _count: { select: { practiceRecords: true, examQuestions: true } } },
    });
    let items = candidates.map(({ _count, ...item }) => ({
        ...item,
        practiceCount: _count.practiceRecords,
        inExam: (_count.examQuestions ?? 0) > 0,
    }));
    // 原题直出模式排除没有题干文字（空或纯空白）的题目
    if (selection.requireQuestionText) {
        items = items.filter((item) => !!item.questionText?.trim());
    }
    return (selection.pickRule ?? DEFAULT_EXAM_PICK_RULE) === 'random'
        ? sampleItems(items, selection.count)
        : pickLeastPracticed(items, selection.count);
}

/** 根据原题全部生成完成情况得出试卷状态 */
export function summarizePaperStatus(statuses: string[]): 'generating' | 'ready' | 'partial' | 'failed' {
    if (statuses.some((status) => status === 'pending')) return 'generating';
    const ready = statuses.filter((status) => status === 'ready').length;
    if (ready === statuses.length) return 'ready';
    return ready === 0 ? 'failed' : 'partial';
}

function parseTagNames(item: { tags: { name: string }[]; knowledgePoints: string | null }): string[] {
    if (item.tags.length > 0) {
        return item.tags.map((tag) => tag.name);
    }
    try {
        const parsed = JSON.parse(item.knowledgePoints || '[]');
        return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
    } catch {
        return [];
    }
}

async function generateQuestion(userId: string, questionId: string, difficulty: DifficultyLevel, language: 'zh' | 'en'): Promise<void> {
    const question = await prisma.examQuestion.findUnique({
        where: { id: questionId },
        select: {
            errorItem: {
                select: { questionText: true, knowledgePoints: true, gradeSemester: true, figureSvg: true, tags: { select: { name: true } } },
            },
        },
    });
    if (!question?.errorItem) {
        await prisma.examQuestion.update({ where: { id: questionId }, data: { status: 'failed', error: 'SOURCE_DELETED' } });
        return;
    }

    try {
        const ai = await getAIService({ userId, kind: 'exam' });
        const generated = await ai.generateSimilarQuestion(
            question.errorItem.questionText || '',
            parseTagNames(question.errorItem),
            language,
            difficulty,
            question.errorItem.gradeSemester,
            question.errorItem.figureSvg
        );
        await prisma.examQuestion.update({
            where: { id: questionId },
            data: {
                status: 'ready',
                questionText: generated.questionText,
                answerText: generated.answerText,
                analysis: generated.analysis,
                figureSvg: generated.figureSvg ?? null,
                error: null,
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({ questionId, error: message }, 'Exam question generation failed');
        await prisma.examQuestion.update({ where: { id: questionId }, data: { status: 'failed', error: message.slice(0, 200) } });
    }
}

const runningPapers = new Set<string>();

/**
 * 生成试卷中尚未成功的题目（新建试卷、重试失败题目、服务重启后续生成均调用此函数）
 * 原题直出（mode=original）的试卷不需要 AI 生成，直接跳过。
 *
 * taskHandle 为路由层用 reserveBackgroundTask 预占的句柄（按 target 防重复），
 * 仅在 /api/exams/:id/retry 路由传入；内部用它登记后台任务进度并自动 succeed/fail。
 */
export async function generateExamPaper(paperId: string, language: 'zh' | 'en' = 'zh', taskHandle?: BackgroundTaskHandle): Promise<void> {
    if (runningPapers.has(paperId)) {
        taskHandle?.cancel();
        return;
    }
    runningPapers.add(paperId);
    let task: BackgroundTaskHandle | null = null;
    try {
        const paper = await prisma.examPaper.findUnique({
            where: { id: paperId },
            select: { userId: true, title: true, difficulty: true, mode: true, questions: { where: { status: { not: 'ready' } }, select: { id: true } } },
        });
        if (!paper) {
            taskHandle?.cancel();
            return;
        }
        // 原题直出：题目创建时即为 ready，无需 AI 生成
        if (paper.mode === 'original') {
            taskHandle?.cancel();
            return;
        }

        const queue = paper.questions.map((question) => question.id);
        const total = queue.length;
        let done = 0;
        if (taskHandle) {
            task = taskHandle;
            if (total > 0) task.setProgress(0, total);
        } else if (total > 0) {
            task = startBackgroundTask({ userId: paper.userId, kind: 'exam', subject: paper.title, link: `/exams/${paperId}`, total });
        }
        if (queue.length > 0) {
            await prisma.examQuestion.updateMany({ where: { id: { in: queue } }, data: { status: 'pending', error: null } });
            await prisma.examPaper.update({ where: { id: paperId }, data: { status: 'generating' } });
        }
        const worker = async () => {
            while (queue.length > 0) {
                await generateQuestion(paper.userId, queue.shift()!, paper.difficulty as DifficultyLevel, language);
                task?.setProgress(++done, total);
            }
        };
        await Promise.all(Array.from({ length: Math.min(GENERATION_CONCURRENCY, queue.length) }, worker));

        const questions = await prisma.examQuestion.findMany({ where: { paperId }, select: { status: true } });
        const paperStatus = summarizePaperStatus(questions.map((question) => question.status));
        await prisma.examPaper.update({ where: { id: paperId }, data: { status: paperStatus } });
        task?.setProgress(done, total, questions.filter((question) => question.status === 'failed').length);
        if (paperStatus === 'failed') task?.fail('ALL_FAILED');
        else task?.succeed();
    } catch (error) {
        logger.error({ paperId, error }, 'Exam paper generation failed');
        task?.fail(error);
    } finally {
        runningPapers.delete(paperId);
    }
}

/** 是否正在本进程中生成（用于识别服务重启后中断的试卷） */
export function isPaperGenerating(paperId: string): boolean {
    return runningPapers.has(paperId);
}

/** question：重新生成题目和解答（仅未录入结果时）；answer：只重新生成解答 */
export const EXAM_REGENERATE_MODES = ['question', 'answer'] as const;
export type ExamRegenerateMode = typeof EXAM_REGENERATE_MODES[number];

export interface RegeneratedExamQuestion {
    status: string;
    questionText: string | null;
    answerText: string | null;
    analysis: string | null;
    figureSvg: string | null;
    error: string | null;
}

const REGENERATED_SELECT = { status: true, questionText: true, answerText: true, analysis: true, figureSvg: true, error: true } as const;

/**
 * 单独重新生成试卷中的一道题。AI 失败时保留原内容并抛出错误。
 * - question：生成新的举一反三题目及解答，已录入结果的题目不允许（HAS_RESULTS）
 * - answer：保留题目，只重新生成答案和解析，并同步该题已录入记录中的解答快照
 *
 * taskHandle 为路由层用 reserveBackgroundTask 预占的句柄（按 target 防重复），
 * 路由校验通过后才传入；内部用它包装 AI 调用并自动 succeed/fail。
 */
export async function regenerateExamQuestion(
    paperId: string,
    questionId: string,
    userId: string,
    mode: ExamRegenerateMode,
    language: 'zh' | 'en' = 'zh',
    taskHandle?: BackgroundTaskHandle,
): Promise<RegeneratedExamQuestion> {
    const question = await prisma.examQuestion.findUnique({
        where: { id: questionId },
        select: {
            paperId: true,
            status: true,
            questionText: true,
            paper: { select: { userId: true, title: true, difficulty: true, mode: true } },
            errorItem: {
                select: {
                    questionText: true,
                    knowledgePoints: true,
                    gradeSemester: true,
                    figureSvg: true,
                    tags: { select: { name: true } },
                    subject: { select: { name: true, stage: true, subjectKey: true } },
                },
            },
            _count: { select: { practiceRecords: true } },
        },
    });
    if (!question || question.paperId !== paperId || question.paper.userId !== userId) {
        taskHandle?.cancel();
        throw new Error('EXAM_QUESTION_NOT_FOUND');
    }
    if (question.status === 'pending') {
        taskHandle?.cancel();
        throw new Error('QUESTION_GENERATING');
    }
    // 预占句柄由路由层传入；未传入时（如测试直接调用）回退到普通登记
    const wrap = <T>(kind: Parameters<typeof startBackgroundTask>[0]['kind'], operation: () => Promise<T>): Promise<T> => {
        const task = taskHandle ?? startBackgroundTask({ userId, subject: question.paper.title, link: `/exams/${paperId}`, kind });
        return runReservedTask(task, operation);
    };

    if (mode === 'question') {
        // 原题直出模式不允许换一道题
        if (question.paper.mode === 'original') {
            taskHandle?.cancel();
            throw new Error('ORIGINAL_MODE');
        }
        if (question._count.practiceRecords > 0) {
            taskHandle?.cancel();
            throw new Error('HAS_RESULTS');
        }
        const source = question.errorItem;
        if (!source) {
            taskHandle?.cancel();
            throw new Error('SOURCE_DELETED');
        }

        const generated = await wrap('exam', async () => (await getAIService({ userId, kind: 'exam' })).generateSimilarQuestion(
            source.questionText || '',
            parseTagNames(source),
            language,
            question.paper.difficulty as DifficultyLevel,
            source.gradeSemester,
            source.figureSvg
        ));
        // AI 生成耗时较长，期间可能已录入结果，写入时再次确认
        const { count } = await prisma.examQuestion.updateMany({
            where: { id: questionId, practiceRecords: { none: {} } },
            data: {
                status: 'ready',
                questionText: generated.questionText,
                answerText: generated.answerText,
                analysis: generated.analysis,
                figureSvg: generated.figureSvg ?? null,
                error: null,
            },
        });
        if (count === 0) throw new Error('HAS_RESULTS');
        await refreshPaperStatus(paperId);
    } else {
        const questionText = question.questionText;
        if (question.status !== 'ready' || !questionText?.trim()) {
            taskHandle?.cancel();
            throw new Error('NO_QUESTION_TEXT');
        }
        const scope = question.errorItem?.subject ? resolveNotebookScope(question.errorItem.subject) : null;
        const subject = scope?.subject ? SUBJECT_DISPLAY_NAMES[scope.subject] : null;

        // 「重新解答」与「换一道题」同属试卷操作，用量记在 exam 名下（与额度扣减一致）
        const result = await wrap('reanswer', async () => (await getAIService({ userId, kind: 'exam' })).reanswerQuestion(
            questionText, language, subject, undefined, question.errorItem?.gradeSemester
        ));
        if (!result.answerText.trim() && !result.analysis.trim()) throw new Error('EMPTY_ANSWER');

        const data = { answerText: result.answerText, analysis: result.analysis };
        await prisma.$transaction([
            prisma.examQuestion.update({ where: { id: questionId }, data }),
            // 已录入记录保存的是同一道题，解答快照一并更新
            prisma.practiceRecord.updateMany({ where: { examQuestionId: questionId }, data }),
        ]);
    }

    const updated = await prisma.examQuestion.findUnique({ where: { id: questionId }, select: REGENERATED_SELECT });
    logger.info({ paperId, questionId, mode }, 'Exam question regenerated');
    return updated!;
}

async function refreshPaperStatus(paperId: string): Promise<void> {
    const questions = await prisma.examQuestion.findMany({ where: { paperId }, select: { status: true } });
    await prisma.examPaper.update({ where: { id: paperId }, data: { status: summarizePaperStatus(questions.map((question) => question.status)) } });
}

export interface ExamResultInput {
    questionId: string;
    result: 'correct' | 'wrong' | 'not_attempted' | null;
}

/**
 * 录入试卷结果：同一题可多次录入，每次作为一条新的举一反三记录写入原题历史（未选择结果的题目跳过），
 * 返回需要重新评估掌握概率的原题 ID
 */
export async function recordExamResults(paperId: string, userId: string, takenAt: Date, results: ExamResultInput[]): Promise<string[]> {
    const paper = await prisma.examPaper.findUnique({
        where: { id: paperId },
        select: {
            userId: true,
            difficulty: true,
            mode: true,
            questions: {
                select: {
                    id: true,
                    errorItemId: true,
                    questionText: true,
                    answerText: true,
                    analysis: true,
                    figureSvg: true,
                    errorItem: { select: { subject: { select: { name: true } } } },
                },
            },
        },
    });
    if (!paper || paper.userId !== userId) {
        throw new Error('EXAM_NOT_FOUND');
    }

    // 原题直出模式没有 AI 生成难度，练习记录的难度写 null
    const recordDifficulty = paper.mode === 'original' ? null : paper.difficulty;

    const questionMap = new Map(paper.questions.map((question) => [question.id, question]));
    const affected = new Set<string>();

    await prisma.$transaction(async (tx) => {
        for (const { questionId, result } of results) {
            const question = questionMap.get(questionId);
            // 原题已删除的题目无法计入举一反三记录
            if (!question?.errorItemId || result === null) continue;

            await tx.practiceRecord.create({
                data: {
                    userId,
                    errorItemId: question.errorItemId,
                    examQuestionId: question.id,
                    source: 'exam',
                    result,
                    isCorrect: result === 'correct',
                    createdAt: takenAt,
                    difficulty: recordDifficulty,
                    subject: question.errorItem?.subject?.name ?? null,
                    questionText: question.questionText,
                    answerText: question.answerText,
                    analysis: question.analysis,
                    figureSvg: question.figureSvg,
                },
            });
            affected.add(question.errorItemId);
        }
        if (affected.size > 0) {
            await tx.examPaper.update({ where: { id: paperId }, data: { resultsRecordedAt: new Date() } });
        }
    });

    return [...affected];
}

/** 从原题快照复制组卷所需字段，用于原题直出模式（不调用 AI） */
export function snapshotOriginalQuestion(item: {
    questionText: string | null;
    answerText: string | null;
    analysis: string | null;
    figureSvg: string | null;
    figureScale: number;
    figureAlign: string;
    answerSpacePx: number | null;
    questionType: string | null;
}) {
    return {
        questionText: item.questionText,
        answerText: item.answerText,
        analysis: item.analysis,
        figureSvg: item.figureSvg,
        figureScale: item.figureScale,
        figureAlign: item.figureAlign,
        answerSpacePx: item.answerSpacePx,
        questionType: item.questionType,
        status: 'ready' as const,
    };
}

/** 原题直出模式需要查询的快照字段（按抽题顺序重排后用于建题） */
const ORIGINAL_SNAPSHOT_SELECT = {
    id: true,
    shortId: true,
    questionText: true,
    answerText: true,
    analysis: true,
    figureSvg: true,
    figureScale: true,
    figureAlign: true,
    answerSpacePx: true,
    questionType: true,
} as const;

export interface CreateExamPaperFromSourcesArgs {
    userId: string;
    mode: ExamMode;
    title: string;
    scope: ExamScope;
    difficulty: string;
    requestedCount: number;
    subjectIdsJson: string;
    tagNamesJson: string | null;
    /** 选出的源题（original 模式要求题干非空已在选题时过滤） */
    sources: { id: string; shortId: string | null; questionType: string | null }[];
    language?: 'zh' | 'en';
    /** 后台触发的生成函数；测试可注入避免副作用。缺省 generateExamPaper */
    startGeneration?: (paperId: string, language: 'zh' | 'en') => void;
    /** 日志标签（缺省 'Exam paper created'） */
    logLabel?: string;
}

/**
 * 按选出的源题创建一份试卷：
 * - original 模式：查询原题快照并按抽题顺序建题，试卷立即可用；
 * - generate 模式：建待生成题目并通过 startGeneration 触发后台生成。
 * 返回创建结果（id/title/requestedCount/题目数），由调用方组装响应。
 */
export async function createExamPaperFromSources(args: CreateExamPaperFromSourcesArgs) {
    const { userId, mode, title, scope, difficulty, requestedCount, subjectIdsJson, tagNamesJson, sources, language } = args;
    let questionsCreate;
    let status: string | undefined;
    let difficultyValue: string = difficulty;
    if (mode === 'original') {
        // 原题直出：不消耗 AI 额度，直接复制原题快照
        const items = await prisma.errorItem.findMany({
            where: { id: { in: sources.map((s) => s.id) } },
            select: ORIGINAL_SNAPSHOT_SELECT,
        });
        // 按抽题顺序（sources）重排，保持 least_practiced / random 的优先级
        const itemMap = new Map(items.map((item) => [item.id, item]));
        const orderedItems = sources.map((s) => itemMap.get(s.id)!).filter(Boolean);
        questionsCreate = orderedItems.map((item, index) => ({
            order: index + 1,
            errorItemId: item.id,
            sourceShortId: item.shortId!,
            ...snapshotOriginalQuestion(item),
        }));
        status = 'ready';
        difficultyValue = 'original';
    } else {
        questionsCreate = sources.map((source, index) => ({
            order: index + 1,
            errorItemId: source.id,
            sourceShortId: source.shortId!,
            questionType: source.questionType,
        }));
    }
    const paper = await prisma.examPaper.create({
        data: {
            userId,
            title,
            status,
            scope,
            difficulty: difficultyValue,
            mode,
            requestedCount,
            subjectIds: subjectIdsJson,
            tagNames: tagNamesJson,
            questions: { create: questionsCreate },
        },
        select: { id: true, title: true, requestedCount: true, _count: { select: { questions: true } } },
    });
    if (mode === 'generate') {
        const start = args.startGeneration ?? ((paperId: string, lang: 'zh' | 'en') => { void generateExamPaper(paperId, lang); });
        start(paper.id, language || 'zh');
    }
    logger.info({ paperId: paper.id, count: sources.length, requested: requestedCount, mode }, args.logLabel ?? 'Exam paper created');
    return paper;
}
