import "server-only";

import { z } from "zod";
import type { KnowledgeTag, Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAIService } from "@/lib/ai";
import type { ParsedQuestion } from "@/lib/ai";
import { consumeAiQuota } from "@/lib/ai-quota";
import { describeQuestion, findRunningTask, reserveBackgroundTask, runReservedTask } from "@/lib/background-tasks";
import { runSerializedTransaction, serializeWrite } from "@/lib/db-write-queue";
import { MAX_FIGURE_SVG_LENGTH, sanitizeFigureSvg } from "@/lib/figure-svg";
import { parseLastPractice, serializeLastPractice } from "@/lib/last-practice";
import type { LastPractice } from "@/lib/last-practice";
import { createLogger } from "@/lib/logger";
import { PRACTICE_RESULTS, scheduleMasteryEvaluation } from "@/lib/mastery";
import { masteryLevelOf } from "@/lib/mastery-status";
import { generatePracticeSchema } from "@/lib/schemas/practice";
import { selectBankQuestion } from "@/lib/question-bank/selection";
import { createNotebookSchema } from "@/lib/schemas/notebooks";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/lib/constants/pagination";
import { ERROR_ITEM_LIST_SELECT } from "@/lib/error-list/error-list-select";
import { buildErrorListWhere, parseErrorListQueryParams } from "@/lib/error-list/error-list-query";
import type { ErrorListQueryParams } from "@/lib/error-list/error-list-query";
import { PRACTICE_RECORD_COUNT, masteryStatusOf } from "@/lib/mastery-status";
import type { MasteryStatus } from "@/lib/mastery-status";
import { getMasteryThreshold } from "@/lib/mastery";
import { getAppTimeZone } from "@/lib/config";
import { getDayRange } from "@/lib/date-time";
import { getReviewPlan, isReviewDue } from "@/lib/review-schedule";
import type { ReviewRecord } from "@/lib/review-schedule";
import { parseStatsRange, getRangeStart } from "@/lib/stats/stats-range";
import type { StatsRange } from "@/lib/stats/stats-range";
import { buildWeakTags, type WeakTagSourceItem } from "@/lib/tags/weak-tags";
import { importSchema, saveQuestion } from "@/lib/question/question-save";
import type { SaveQuestionResult } from "@/lib/question/question-save";
import type { QuestionTypeFilterValue, TimeFilter } from "@/lib/error-list/error-list-filters";
import type { NotebookStage, NotebookSubject } from "@/lib/notebook-scope";

/** 工具调用失败：消息直接返回给 MCP 客户端 */
export class McpToolError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "McpToolError";
    }
}

export interface NotebookSummary {
    id: string;
    name: string;
    stage: string;
    subjectKey: string | null;
    tagSet: string;
    questionCount: number;
    createdAt: Date;
}

export async function listNotebooks(userId: string): Promise<NotebookSummary[]> {
    const notebooks = await prisma.subject.findMany({
        where: { userId },
        include: { _count: { select: { errorItems: true } } },
        orderBy: { createdAt: "desc" },
    });
    return notebooks.map(({ _count, ...notebook }) => ({
        ...notebook,
        questionCount: _count.errorItems,
    }));
}

export interface CreateNotebookInput {
    name: string;
    stage: NotebookStage;
    subjectKey: NotebookSubject;
    tagSet?: string;
}

export async function createNotebook(user: User, input: CreateNotebookInput): Promise<NotebookSummary> {
    const parsed = createNotebookSchema.safeParse(input);
    if (!parsed.success) {
        throw new McpToolError(parsed.error.issues[0]?.message ?? "Invalid notebook name, stage or subject");
    }
    const { name, stage, subjectKey } = parsed.data;
    const tagSet = parsed.data.tagSet?.trim() || "default";

    const existing = await prisma.subject.findUnique({
        where: { name_userId: { name: name.trim(), userId: user.id } },
    });
    if (existing) {
        throw new McpToolError(`Notebook "${name.trim()}" already exists`);
    }

    const notebook = await prisma.subject.create({
        data: { name: name.trim(), stage, subjectKey, tagSet, userId: user.id },
        include: { _count: { select: { errorItems: true } } },
    });
    const { _count, ...created } = notebook;
    return { ...created, questionCount: _count.errorItems };
}

export interface ListQuestionsInput {
    notebookId?: string;
    query?: string;
    tag?: string;
    chapter?: string;
    mastery?: MasteryStatus;
    timeRange?: TimeFilter;
    gradeSemester?: string;
    paperLevel?: string;
    questionTypes?: QuestionTypeFilterValue[];
    page?: number;
    pageSize?: number;
}

export async function listQuestions(user: User, input: ListQuestionsInput) {
    const params = new URLSearchParams();
    if (input.notebookId) params.set("subjectId", input.notebookId);
    if (input.query) params.set("query", input.query);
    if (input.tag) params.set("tag", input.tag);
    if (input.chapter) params.set("chapter", input.chapter);
    if (input.mastery) params.set("mastery", input.mastery);
    if (input.timeRange) params.set("timeRange", input.timeRange);
    if (input.gradeSemester) params.set("gradeSemester", input.gradeSemester);
    if (input.paperLevel) params.set("paperLevel", input.paperLevel);
    if (input.questionTypes?.length) params.set("questionTypes", input.questionTypes.join(","));
    if (input.page !== undefined) params.set("page", String(input.page));
    if (input.pageSize !== undefined) params.set("pageSize", String(input.pageSize));

    const query: ErrorListQueryParams = parseErrorListQueryParams(params);
    const where = await buildErrorListWhere(query, user.id, user.masteryThreshold, prisma);

    const select = {
        ...ERROR_ITEM_LIST_SELECT,
        subject: { select: { id: true, name: true } },
    } satisfies Prisma.ErrorItemSelect;

    const [total, items] = await Promise.all([
        prisma.errorItem.count({ where }),
        prisma.errorItem.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
            select,
        }),
    ]);

    return {
        items: items.map(({ _count, ...item }) => ({
            ...item,
            masteryStatus: masteryStatusOf(_count.practiceRecords, item.masteryProbability, user.masteryThreshold),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(total / query.pageSize),
    };
}

export interface GetQuestionInput {
    id: string;
    includeImage?: boolean;
}

export async function getQuestion(userId: string, masteryThreshold: number, input: GetQuestionInput) {
    const select = {
        id: true,
        shortId: true,
        questionText: true,
        answerText: true,
        analysis: true,
        wrongAnswerText: true,
        mistakeAnalysis: true,
        mistakeStatus: true,
        knowledgePoints: true,
        questionType: true,
        source: true,
        gradeSemester: true,
        difficultyStars: true,
        masteryProbability: true,
        masteryReason: true,
        createdAt: true,
        updatedAt: true,
        subject: { select: { id: true, name: true } },
        tags: { select: { id: true, name: true } },
        _count: PRACTICE_RECORD_COUNT,
        ...(input.includeImage ? { originalImageUrl: true } : {}),
    } satisfies Prisma.ErrorItemSelect;

    const item = await prisma.errorItem.findFirst({
        where: { userId, OR: [{ id: input.id }, { shortId: input.id }] },
        select,
    });
    if (!item) {
        throw new McpToolError(`Question "${input.id}" not found`);
    }
    const { _count, ...rest } = item;
    return {
        ...rest,
        practiceRecordCount: _count.practiceRecords,
        masteryStatus: masteryStatusOf(_count.practiceRecords, item.masteryProbability, masteryThreshold),
    };
}

export interface AddQuestionInput {
    notebookId?: string;
    subjectName?: string;
    questionText?: string;
    answerText?: string;
    analysis?: string;
    wrongAnswerText?: string;
    mistakeAnalysis?: string;
    mistakeStatus?: string;
    knowledgePoints?: string[];
    gradeSemester?: string;
    recognizedGradeSemester?: string;
    paperLevel?: string;
    difficultyStars?: number;
    questionType?: string;
    source?: string;
    originalImageUrl?: string;
    geogebraCommands?: string;
    hasFigure?: boolean;
    figureSvg?: string;
    figureImage?: string;
    figureSource?: string;
}

export async function addQuestion(user: User, input: AddQuestionInput): Promise<SaveQuestionResult> {
    if (input.notebookId) {
        const notebook = await prisma.subject.findFirst({
            where: { id: input.notebookId, userId: user.id },
            select: { id: true },
        });
        if (!notebook) {
            throw new McpToolError(`Notebook "${input.notebookId}" not found for this user`);
        }
    }

    const body = {
        ...input,
        subjectId: input.notebookId ?? undefined,
        subjectName: input.subjectName ?? undefined,
    };
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path.join(".");
        throw new McpToolError(`Invalid question input${path ? ` at ${path}` : ""}: ${issue?.message ?? "unknown error"}`);
    }
    return saveQuestion(user, parsed.data, { origin: "mcp" });
}

export interface ListTagsInput {
    subject: string;
    tagSet?: string;
    query?: string;
    flat?: boolean;
}

interface TagTreeNode {
    id: string;
    name: string;
    code: string | null;
    isSystem: boolean;
    children: TagTreeNode[];
}

function buildTagTree(tags: KnowledgeTag[]): TagTreeNode[] {
    const nodes = new Map<string, TagTreeNode>();
    const roots: TagTreeNode[] = [];
    for (const tag of tags) {
        nodes.set(tag.id, { id: tag.id, name: tag.name, code: tag.code, isSystem: tag.isSystem, children: [] });
    }
    for (const tag of tags) {
        const node = nodes.get(tag.id)!;
        const parent = tag.parentId ? nodes.get(tag.parentId) : undefined;
        if (parent) parent.children.push(node);
        else roots.push(node);
    }
    return roots;
}

export async function listTags(userId: string, input: ListTagsInput) {
    const tagSet = input.tagSet?.trim() || "default";
    const tags = await prisma.knowledgeTag.findMany({
        where: {
            subject: input.subject,
            tagSet,
            OR: [{ isSystem: true }, { userId }],
            ...(input.query ? { name: { contains: input.query } } : {}),
        },
        orderBy: [{ order: "asc" }, { name: "asc" }],
    });

    if (input.flat !== false) {
        const leaves = tags.filter((tag) => !tags.some((other) => other.parentId === tag.id));
        return {
            tags: leaves.map((tag) => {
                const parent = tag.parentId ? tags.find((item) => item.id === tag.parentId) : null;
                return {
                    id: tag.id,
                    name: tag.name,
                    isSystem: tag.isSystem,
                    parentId: tag.parentId,
                    parentName: parent?.name ?? null,
                };
            }),
        };
    }

    return { tags: buildTagTree(tags) };
}

export interface ListDueReviewsInput {
    notebookId?: string;
    page?: number;
    pageSize?: number;
}

/** 今日待复习：按作答历史推算到期的错题，最早到期的排在前面 */
export async function listDueReviews(userId: string, input: ListDueReviewsInput) {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, input.pageSize ?? DEFAULT_PAGE_SIZE));
    const timeZone = getAppTimeZone();
    const now = new Date();

    const [candidates, answeredRecords] = await Promise.all([
        prisma.errorItem.findMany({
            where: { userId, ...(input.notebookId ? { subjectId: input.notebookId } : {}) },
            select: { id: true, createdAt: true },
        }),
        prisma.practiceRecord.findMany({
            where: { userId, errorItemId: { not: null }, result: { in: ["correct", "wrong"] } },
            select: { errorItemId: true, result: true, createdAt: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
    ]);

    const recordsByItem = new Map<string, ReviewRecord[]>();
    for (const { errorItemId, result, createdAt } of answeredRecords) {
        if (!errorItemId) continue;
        const records = recordsByItem.get(errorItemId);
        if (records) records.push({ result, createdAt });
        else recordsByItem.set(errorItemId, [{ result, createdAt }]);
    }

    const masteryThreshold = await getMasteryThreshold(userId);
    const due = candidates
        .map((item) => ({
            id: item.id,
            plan: getReviewPlan(item.createdAt, recordsByItem.get(item.id) ?? [], timeZone),
        }))
        .filter(({ plan }) => isReviewDue(plan, timeZone, now))
        .sort((a, b) => a.plan.nextReviewAt!.getTime() - b.plan.nextReviewAt!.getTime());

    const pageEntries = due.slice((page - 1) * pageSize, page * pageSize);
    const items = await prisma.errorItem.findMany({
        where: { id: { in: pageEntries.map(({ id }) => id) } },
        select: {
            id: true,
            shortId: true,
            questionText: true,
            masteryProbability: true,
            createdAt: true,
            subject: { select: { id: true, name: true } },
            tags: { select: { id: true, name: true } },
            _count: PRACTICE_RECORD_COUNT,
        },
    });
    const itemById = new Map(items.map((item) => [item.id, item]));

    return {
        items: pageEntries.flatMap(({ id, plan }) => {
            const found = itemById.get(id);
            if (!found) return [];
            const { _count, ...item } = found;
            return [{
                ...item,
                masteryStatus: masteryStatusOf(_count.practiceRecords, item.masteryProbability, masteryThreshold),
                reviewStage: plan.stage,
                nextReviewAt: plan.nextReviewAt,
            }];
        }),
        total: due.length,
        page,
        pageSize,
        totalPages: Math.ceil(due.length / pageSize),
    };
}

export interface GetWeakTagsInput {
    notebookId?: string;
    range?: StatsRange;
    limit?: number;
}

/** 薄弱知识点排行：按错题创建时间范围与学科聚合，取未掌握数 > 0 的前 N 个 */
export async function getWeakTags(userId: string, input: GetWeakTagsInput) {
    let subjectId: string | null = null;
    if (input.notebookId) {
        const notebook = await prisma.subject.findFirst({
            where: { id: input.notebookId, userId },
            select: { id: true, name: true },
        });
        if (!notebook) {
            throw new McpToolError(`Notebook "${input.notebookId}" not found for this user`);
        }
        subjectId = notebook.id;
    }

    const now = new Date();
    const timeZone = getAppTimeZone();
    const range = parseStatsRange(input.range ?? null);
    const rangeStart = getRangeStart(range, now, timeZone);
    const recentStart = getDayRange(now, timeZone, -29).start;
    const recentEnd = getDayRange(now, timeZone, 1).end;
    const masteryThreshold = await getMasteryThreshold(userId);

    const items = await prisma.errorItem.findMany({
        where: {
            userId,
            ...(subjectId ? { subjectId } : {}),
            ...(rangeStart ? { createdAt: { gte: rangeStart } } : {}),
        },
        select: {
            id: true,
            subjectId: true,
            subject: { select: { name: true } },
            masteryProbability: true,
            tags: { select: { name: true, tagSet: true } },
            _count: PRACTICE_RECORD_COUNT,
            practiceRecords: {
                where: {
                    result: { in: ["correct", "wrong", "not_attempted"] },
                    createdAt: { gte: recentStart, lt: recentEnd },
                },
                select: { result: true, source: true },
            },
        },
    });

    const sourceItems: WeakTagSourceItem[] = items.map((item) => ({
        id: item.id,
        subjectId: item.subjectId,
        subjectName: item.subject?.name ?? null,
        masteryProbability: item.masteryProbability,
        tags: item.tags,
        practiceRecordCount: item._count.practiceRecords,
        recentResults: item.practiceRecords
            .filter((record) => record.source !== "duplicate_import")
            .map((record) => record.result),
    }));

    return {
        weakTags: buildWeakTags(sourceItems, { masteryThreshold }, Math.min(50, Math.max(1, input.limit ?? 10))),
        range,
    };
}

const logger = createLogger('mcp:service');

const DIFFICULTIES = ['easy', 'medium', 'hard', 'harder'] as const;
const PRACTICE_SOURCES = ['practice', 'manual', 'review'] as const;

/** 把 consumeAiQuota 的拒绝响应转成工具错误；文本带上 code，供客户端识别（如 AI_QUOTA_INSUFFICIENT） */
async function quotaRejectionError(rejection: Response): Promise<McpToolError> {
    const body = await rejection.clone().json().catch(() => null) as { code?: unknown; message?: unknown } | null;
    const code = typeof body?.code === 'string' ? body.code : 'AI_QUOTA_INSUFFICIENT';
    const message = typeof body?.message === 'string' ? body.message : 'AI quota is insufficient';
    return new McpToolError(`${code}: ${message}`);
}

const recordPracticeSchema = z.object({
    errorItemId: z.string().min(1).optional(),
    practiceQuestionId: z.string().min(1).optional(),
    result: z.enum(PRACTICE_RESULTS as [string, ...string[]]).optional(),
    isCorrect: z.boolean().nullable().optional(),
    subject: z.string().max(50).nullable().optional(),
    difficulty: z.string().max(20).nullable().optional(),
    questionText: z.string().max(20000).nullable().optional(),
    answerText: z.string().max(20000).nullable().optional(),
    analysis: z.string().max(50000).nullable().optional(),
    mistakeAnalysis: z.string().max(50000).nullable().optional(),
    figureSvg: z.string().max(MAX_FIGURE_SVG_LENGTH).nullable().optional(),
    // manual：在错题详情中直接录入结果，不附带新题；review：在今日复习中按顺序作答
    source: z.enum(PRACTICE_SOURCES).optional(),
    takenAt: z.string().datetime({ offset: true }).optional(),
}).refine((value) => value.errorItemId || value.practiceQuestionId, {
    message: 'errorItemId or practiceQuestionId is required',
    path: ['errorItemId'],
});

export type RecordPracticeResultInput = z.input<typeof recordPracticeSchema>;

/** 记录一次作答结果：校验题目归属、补齐题目字段，并更新掌握概率与复习排期 */
export async function recordPracticeResult(user: User, input: RecordPracticeResultInput) {
    const parsed = recordPracticeSchema.safeParse(input);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new McpToolError(`Invalid practice record: ${issue?.message ?? 'unknown error'}`);
    }

    let errorItemId = parsed.data.errorItemId;
    const practiceQuestionId = parsed.data.practiceQuestionId;
    let { difficulty, questionText, answerText, analysis } = parsed.data;
    const mistakeAnalysis = parsed.data.mistakeAnalysis;
    let questionFigureSvg: string | null = null;
    let subject = parsed.data.subject;
    const source = parsed.data.source ?? 'practice';
    const figureSvg = sanitizeFigureSvg(parsed.data.figureSvg);
    // 兼容只传 isCorrect 的调用方
    const result = parsed.data.result
        ?? (parsed.data.isCorrect === true ? 'correct' : parsed.data.isCorrect === false ? 'wrong' : undefined);

    const userId = user.id;
    const requestedErrorItemId = errorItemId;

    // errorItemId 同时接受 CUID 与 6 位短 ID；先解析为 CUID，再与练习题目的关联比对
    if (errorItemId) {
        const resolved = await prisma.errorItem.findFirst({
            where: { userId, OR: [{ id: errorItemId }, { shortId: errorItemId }] },
            select: { id: true },
        });
        if (!resolved) {
            throw new McpToolError(`Item "${requestedErrorItemId}" not found for this user`);
        }
        errorItemId = resolved.id;
    }

    // 历史题作答：校验题目归属，并从题目补齐原题、学科与难度
    if (practiceQuestionId) {
        const question = await prisma.practiceQuestion.findUnique({
            where: { id: practiceQuestionId },
            select: {
                userId: true,
                errorItemId: true,
                subject: true,
                difficulty: true,
                questionText: true,
                answerText: true,
                analysis: true,
                figureSvg: true,
            },
        });
        if (!question || question.userId !== userId) {
            throw new McpToolError(`Practice question "${practiceQuestionId}" not found for this user`);
        }
        if (errorItemId && question.errorItemId && errorItemId !== question.errorItemId) {
            throw new McpToolError('Practice question does not belong to this item');
        }
        errorItemId ??= question.errorItemId ?? undefined;
        subject ??= question.subject;
        difficulty ??= question.difficulty;
        questionText ??= question.questionText;
        answerText ??= question.answerText;
        analysis ??= question.analysis;
        questionFigureSvg = sanitizeFigureSvg(question.figureSvg);
    }

    // 关联原题时校验归属，防止写入他人的错题
    if (errorItemId) {
        const item = await prisma.errorItem.findUnique({
            where: { id: errorItemId },
            select: { userId: true, subject: { select: { name: true } } },
        });
        if (!item || item.userId !== userId) {
            throw new McpToolError(`Item "${errorItemId}" not found for this user`);
        }
        subject ??= item.subject?.name ?? null;
    }

    const isCorrect = result ? result === 'correct' : parsed.data.isCorrect;

    const record = await prisma.practiceRecord.create({
        data: {
            userId,
            subject,
            difficulty,
            isCorrect,
            ...(practiceQuestionId ? { practiceQuestionId } : {}),
            ...(errorItemId ? { errorItemId } : {}),
            ...((errorItemId || practiceQuestionId) ? {
                result,
                questionText,
                answerText,
                analysis,
                mistakeAnalysis,
                figureSvg: figureSvg ?? questionFigureSvg,
                source,
            } : {}),
            ...(parsed.data.takenAt ? { createdAt: new Date(parsed.data.takenAt) } : {}),
        },
    });

    if (errorItemId && result) {
        if (source === 'review' && result === 'correct') {
            // 顺序复习中明确做对，直接标记为已掌握，不必等待后台评估
            await prisma.errorItem.update({
                where: { id: errorItemId },
                data: {
                    masteryProbability: 1,
                    masteryLevel: masteryLevelOf('mastered'),
                    masterySource: 'rule',
                    masteryReason: '顺序复习做对，标记为已掌握',
                    masteryEvaluatedAt: new Date(),
                },
            });
        } else {
            scheduleMasteryEvaluation([errorItemId]);
        }
    }

    return record;
}

export interface GenerateVariantInput {
    errorItemId: string;
    language?: 'zh' | 'en';
    difficulty?: 'easy' | 'medium' | 'hard' | 'harder';
    source?: 'ai' | 'bank' | 'bankVariant';
    bankId?: string;
}

/** 同步生成一道变式题（AI 或真题库），消耗一次 practice 额度并暂存为最近一次练习 */
export async function generateVariant(user: User, input: GenerateVariantInput) {
    const parsed = generatePracticeSchema.safeParse(input);
    if (!parsed.success) {
        throw new McpToolError(parsed.error.issues[0]?.message ?? 'Invalid generate variant input');
    }
    const { errorItemId, language, difficulty, source, bankId } = parsed.data;

    // errorItemId 同时接受 CUID 与 6 位短 ID；后续写入一律使用解析出的 CUID
    const errorItemWithSubject = await prisma.errorItem.findFirst({
        where: { userId: user.id, OR: [{ id: errorItemId }, { shortId: errorItemId }] },
        include: { subject: true, tags: { select: { name: true } } },
    });
    // 只能基于自己的错题生成，否则等于间接读取他人题目
    if (!errorItemWithSubject) {
        throw new McpToolError(`Item "${errorItemId}" not found for this user`);
    }
    const resolvedErrorItemId = errorItemWithSubject.id;

    let tags: string[] = Array.isArray(errorItemWithSubject.tags)
        ? errorItemWithSubject.tags.map((tag) => tag.name)
        : [];
    if (tags.length === 0) {
        try {
            const parsedTags: unknown = JSON.parse(errorItemWithSubject.knowledgePoints || "[]");
            tags = Array.isArray(parsedTags) ? parsedTags.filter((tag): tag is string => typeof tag === 'string') : [];
        } catch {
            tags = [];
        }
    }

    // 按目标防重复：同一错题同一时刻只允许一个「举一反三」任务，预占失败时不扣额度、不调用 AI
    const target = `error-item:${resolvedErrorItemId}:practice`;
    const handle = reserveBackgroundTask({
        userId: user.id,
        kind: 'practice',
        subject: describeQuestion(errorItemWithSubject),
        link: `/error-items/${resolvedErrorItemId}`,
        target,
    });
    if (!handle) {
        throw new McpToolError(
            `TASK_ALREADY_RUNNING: another practice task is running for this item (${findRunningTask(user.id, target)?.id ?? 'unknown'})`,
        );
    }

    const selectionInput = {
        errorItem: {
            id: errorItemWithSubject.id,
            questionText: errorItemWithSubject.questionText,
            subject: errorItemWithSubject.subject
                ? {
                    name: errorItemWithSubject.subject.name,
                    stage: errorItemWithSubject.subject.stage,
                    subjectKey: errorItemWithSubject.subject.subjectKey,
                }
                : null,
        },
        tagNames: tags,
        difficulty: difficulty ?? 'medium',
        bankId: bankId ?? null,
    };

    let practiceQuestion: ParsedQuestion;
    if (source === 'bank') {
        // 真题库选题不调用 AI、不消耗额度
        const selected = await runReservedTask(handle, () => selectBankQuestion(selectionInput));
        if (!selected) {
            handle.cancel();
            throw new McpToolError('BANK_NO_MATCH: no bank question matches this item');
        }
        practiceQuestion = selected.question;
    } else if (source === 'bankVariant') {
        // 先按知识点选题库题目，再让 AI 以该题为原题生成变式题：选题失败时不扣额度
        const outcome = await runReservedTask(handle, async () => {
            const selected = await selectBankQuestion(selectionInput);
            if (!selected) {
                handle.cancel();
                return { kind: 'no-match' as const };
            }
            const limited = await serializeWrite(() => consumeAiQuota(user, 'practice'));
            if (limited) {
                handle.cancel();
                return { kind: 'limited' as const, limited };
            }
            const aiService = await getAIService({ userId: user.id, kind: 'practice' });
            const similarQuestion = await aiService.generateSimilarQuestion(
                selected.question.questionText,
                selected.question.knowledgePoints.length > 0 ? selected.question.knowledgePoints : tags,
                language,
                difficulty || 'medium',
                selected.question.gradeSemester,
                selected.question.figureSvg,
            );
            similarQuestion.subject = selected.question.subject;
            return { kind: 'ok' as const, question: similarQuestion };
        });
        if (outcome.kind === 'no-match') {
            throw new McpToolError('BANK_NO_MATCH: no bank question matches this item');
        }
        if (outcome.kind === 'limited') {
            throw await quotaRejectionError(outcome.limited);
        }
        practiceQuestion = outcome.question;
    } else {
        const outcome = await runReservedTask(handle, async () => {
            const limited = await serializeWrite(() => consumeAiQuota(user, 'practice'));
            if (limited) {
                handle.cancel();
                return { kind: 'limited' as const, limited };
            }
            const aiService = await getAIService({ userId: user.id, kind: 'practice' });
            const similarQuestion = await aiService.generateSimilarQuestion(
                errorItemWithSubject.questionText || "",
                tags,
                language,
                difficulty || 'medium',
                errorItemWithSubject.gradeSemester,
                errorItemWithSubject.figureSvg,
            );
            // 学科取数据库中的真实学科名；AI 输出不在学科列表内时按「其他」
            const validSubjects = ["数学", "科学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"] as const;
            const subjectName = errorItemWithSubject.subject?.name || "其他";
            similarQuestion.subject = (validSubjects as readonly string[]).includes(subjectName)
                ? subjectName as typeof validSubjects[number]
                : "其他";
            return { kind: 'ok' as const, question: similarQuestion };
        });
        if (outcome.kind === 'limited') {
            throw await quotaRejectionError(outcome.limited);
        }
        practiceQuestion = outcome.question;
    }

    // 暂存本次生成结果，下次进入练习页直接显示
    const lastPractice: LastPractice = {
        questionText: practiceQuestion.questionText,
        answerText: practiceQuestion.answerText,
        analysis: practiceQuestion.analysis,
        subject: practiceQuestion.subject,
        figureSvg: practiceQuestion.figureSvg ?? null,
        difficulty: DIFFICULTIES.find((value) => value === difficulty) ?? 'medium',
        source: source === 'bank' ? 'bank' : source === 'bankVariant' ? 'bankVariant' : 'ai',
        generatedAt: new Date().toISOString(),
    };
    // 每次生成都新增一条历史题，并同步暂存字段；写入失败时明确返回 saved: false
    let practiceQuestionId: string | null = null;
    let saved = false;
    try {
        const created = await runSerializedTransaction(async (tx) => {
            const question = await tx.practiceQuestion.create({
                data: {
                    userId: user.id,
                    errorItemId: resolvedErrorItemId,
                    subject: lastPractice.subject ?? null,
                    difficulty: lastPractice.difficulty,
                    source: lastPractice.source ?? 'ai',
                    questionText: lastPractice.questionText,
                    answerText: lastPractice.answerText,
                    analysis: lastPractice.analysis,
                    figureSvg: lastPractice.figureSvg ?? null,
                    generatedAt: new Date(lastPractice.generatedAt),
                },
            });
            await tx.errorItem.update({
                where: { id: resolvedErrorItemId },
                data: { lastPractice: serializeLastPractice(lastPractice) },
            });
            return question;
        });
        practiceQuestionId = created.id;
        saved = true;
    } catch (error) {
        logger.warn({ error, errorItemId: resolvedErrorItemId }, 'Failed to persist generated practice question');
    }

    return {
        ...practiceQuestion,
        difficulty: lastPractice.difficulty,
        source: lastPractice.source,
        generatedAt: lastPractice.generatedAt,
        practiceQuestionId,
        saved,
    };
}

export interface GetVariantInput {
    errorItemId: string;
}

/** 读取该错题最近一次生成的变式题；没有时返回 { practice: null } */
export async function getVariant(userId: string, input: GetVariantInput): Promise<{ practice: LastPractice | null }> {
    const item = await prisma.errorItem.findFirst({
        where: { userId, OR: [{ id: input.errorItemId }, { shortId: input.errorItemId }] },
        select: { lastPractice: true },
    });
    if (!item) {
        throw new McpToolError(`Item "${input.errorItemId}" not found for this user`);
    }
    return { practice: parseLastPractice(item.lastPractice) };
}

const gradeAnswerSchema = z.object({
    errorItemId: z.string().trim().min(1).optional(),
    practiceQuestionId: z.string().trim().min(1).optional(),
    userAnswer: z.string().trim().min(1).max(5000),
    language: z.enum(['zh', 'en']).optional(),
}).refine((value) => value.errorItemId || value.practiceQuestionId, {
    message: 'errorItemId or practiceQuestionId is required',
    path: ['errorItemId'],
});

export type GradeAnswerInput = z.input<typeof gradeAnswerSchema>;

/** 由 AI 对照已存题目与标准答案判定作答；消耗一次 grade 额度 */
export async function gradeAnswer(user: User, input: GradeAnswerInput) {
    const parsed = gradeAnswerSchema.safeParse(input);
    if (!parsed.success) {
        throw new McpToolError(parsed.error.issues[0]?.message ?? 'Invalid grading request');
    }
    const { errorItemId, practiceQuestionId, userAnswer, language } = parsed.data;

    // 历史题直接读取已保存的题目与答案；旧流程仍读取错题的最近一次生成结果
    let practice: { questionText: string; answerText: string; analysis: string } | null = null;
    if (practiceQuestionId) {
        const stored = await prisma.practiceQuestion.findUnique({
            where: { id: practiceQuestionId },
            select: { userId: true, questionText: true, answerText: true, analysis: true },
        });
        practice = stored && stored.userId === user.id
            ? { questionText: stored.questionText, answerText: stored.answerText, analysis: stored.analysis }
            : null;
    } else if (errorItemId) {
        // errorItemId 同时接受 CUID 与 6 位短 ID
        const item = await prisma.errorItem.findFirst({
            where: { userId: user.id, OR: [{ id: errorItemId }, { shortId: errorItemId }] },
            select: { lastPractice: true },
        });
        practice = item ? parseLastPractice(item.lastPractice) : null;
    }
    if (!practice) {
        throw new McpToolError('Practice question not found');
    }

    const limited = await consumeAiQuota(user, 'grade');
    if (limited) {
        throw await quotaRejectionError(limited);
    }

    const aiService = await getAIService({ userId: user.id, kind: 'grade' });
    return aiService.gradeAnswer({
        questionText: practice.questionText,
        answerText: practice.answerText,
        analysis: practice.analysis,
        userAnswer,
        language,
    });
}

