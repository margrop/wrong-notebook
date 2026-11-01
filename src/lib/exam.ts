import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getAIService } from "@/lib/ai";
import type { DifficultyLevel } from "@/lib/ai/types";
import { createLogger } from "@/lib/logger";
import { getMasteryThreshold } from "@/lib/mastery";
import { DEFAULT_MASTERY_THRESHOLD, masteryStatusWhere } from "@/lib/mastery-status";
import { startBackgroundTask, trackBackgroundTask } from "@/lib/background-tasks";
import { resolveNotebookScope, SUBJECT_DISPLAY_NAMES } from "@/lib/notebook-scope";
import type { BackgroundTaskHandle } from "@/lib/background-tasks";

const logger = createLogger('exam');

export const EXAM_SCOPES = ['unmastered', 'mastered', 'all'] as const;
export type ExamScope = typeof EXAM_SCOPES[number];
export const EXAM_DIFFICULTIES = ['easy', 'medium', 'hard', 'harder'] as const;
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
    scope: ExamScope;
    count: number;
    pickRule?: ExamPickRule;
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
    const candidates = await prisma.errorItem.findMany({
        where: buildSourceWhere(userId, selection, await getMasteryThreshold(userId)),
        select: { id: true, shortId: true, _count: { select: { practiceRecords: true, examQuestions: true } } },
    });
    const items = candidates.map(({ _count, ...item }) => ({
        ...item,
        practiceCount: _count.practiceRecords,
        inExam: (_count.examQuestions ?? 0) > 0,
    }));
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

async function generateQuestion(questionId: string, difficulty: DifficultyLevel, language: 'zh' | 'en'): Promise<void> {
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
        const generated = await getAIService().generateSimilarQuestion(
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
 */
export async function generateExamPaper(paperId: string, language: 'zh' | 'en' = 'zh'): Promise<void> {
    if (runningPapers.has(paperId)) return;
    runningPapers.add(paperId);
    let task: BackgroundTaskHandle | null = null;
    try {
        const paper = await prisma.examPaper.findUnique({
            where: { id: paperId },
            select: { userId: true, title: true, difficulty: true, questions: { where: { status: { not: 'ready' } }, select: { id: true } } },
        });
        if (!paper) return;

        const queue = paper.questions.map((question) => question.id);
        const total = queue.length;
        let done = 0;
        if (total > 0) task = startBackgroundTask({ userId: paper.userId, kind: 'exam', subject: paper.title, link: `/exams/${paperId}`, total });
        if (queue.length > 0) {
            await prisma.examQuestion.updateMany({ where: { id: { in: queue } }, data: { status: 'pending', error: null } });
            await prisma.examPaper.update({ where: { id: paperId }, data: { status: 'generating' } });
        }
        const worker = async () => {
            while (queue.length > 0) {
                await generateQuestion(queue.shift()!, paper.difficulty as DifficultyLevel, language);
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
 */
export async function regenerateExamQuestion(
    paperId: string,
    questionId: string,
    userId: string,
    mode: ExamRegenerateMode,
    language: 'zh' | 'en' = 'zh'
): Promise<RegeneratedExamQuestion> {
    const question = await prisma.examQuestion.findUnique({
        where: { id: questionId },
        select: {
            paperId: true,
            status: true,
            questionText: true,
            paper: { select: { userId: true, title: true, difficulty: true } },
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
        throw new Error('EXAM_QUESTION_NOT_FOUND');
    }
    if (question.status === 'pending') {
        throw new Error('QUESTION_GENERATING');
    }
    const task = { userId, subject: question.paper.title, link: `/exams/${paperId}` };

    if (mode === 'question') {
        if (question._count.practiceRecords > 0) throw new Error('HAS_RESULTS');
        const source = question.errorItem;
        if (!source) throw new Error('SOURCE_DELETED');

        const generated = await trackBackgroundTask({ ...task, kind: 'exam' }, () => getAIService().generateSimilarQuestion(
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
        if (question.status !== 'ready' || !questionText?.trim()) throw new Error('NO_QUESTION_TEXT');
        const scope = question.errorItem?.subject ? resolveNotebookScope(question.errorItem.subject) : null;
        const subject = scope?.subject ? SUBJECT_DISPLAY_NAMES[scope.subject] : null;

        const result = await trackBackgroundTask({ ...task, kind: 'reanswer' }, () => getAIService().reanswerQuestion(
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
                    difficulty: paper.difficulty,
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
