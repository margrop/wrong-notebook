import "server-only";

import type { KnowledgeTag, Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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

