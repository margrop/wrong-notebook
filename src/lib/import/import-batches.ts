/**
 * 多题录入批次（服务端持久化）：一段多题文字或一张多题照片 → 分题草稿 → 用户确认后逐题解析 → 入库或逐题校对。
 *
 * - 文字按本地规则分题时立即得到草稿，不调用 AI；选择「用 AI 分题」或照片自动分题时在后台调用模型，
 *   完成前后都可以离开页面，回来后从批次页或「识别任务」取回。
 * - 草稿保存在服务端并带版本号，多处同时编辑时不会静默覆盖。
 * - 开始解析时用带条件的更新抢占（draft → started），同一批次只会建一次任务；之后每道题就是一个普通的识别任务，
 *   沿用已有的后台执行、判重、年级/卷别规则、中断恢复与重试，只有真正建出的任务计 AI 额度。
 * - 所有读写都按用户过滤，其他用户的批次一律视为不存在。
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { Prisma, User } from "@prisma/client";
import { z } from "zod";
import { consumeAiQuota, quotaRejectionCode } from "@/lib/ai-quota";
import type { ParsedQuestion } from "@/lib/ai";
import { MAX_SPLIT_LINES } from "@/lib/ai/question-split";
import type { QuestionSplitInput } from "@/lib/ai/question-split";
import { createErrorResponse, ErrorCode, notFound, validationError } from "@/lib/api-errors";
import { describeQuestion } from "@/lib/background-tasks";
import { draftItemToParsed } from "@/lib/import/draft-to-parsed";
import { getErrorMessage } from "@/lib/error-message";
import { batchPhase, MAX_START_IMAGES_LENGTH } from "@/lib/import/import-batch-types";
import type { ImportBatchCounts, ImportBatchDetail, ImportBatchSource, ImportBatchSplitter, ImportBatchStatus, ImportBatchSummary } from "@/lib/import/import-batch-types";
import { IMPORT_TASK_INTERRUPTED_ERROR, SAVED_IMPORT_TASK_RETENTION_DAYS } from "@/lib/import/import-task-types";
import type { ImportTaskMode, ImportTaskStatus, ImportTaskSummary } from "@/lib/import/import-task-types";
import {
    bootId, confirmImportTask, isInterrupted, listImportTasks, markFailed, parseResult, quotaKindOf, reconcileInterrupted as reconcileInterruptedTasks, register, retryImportTask,
    scheduleImportTask, scheduleWork, startHeartbeat, summarySelect, toSummary,
} from "@/lib/import/import-tasks";
import { createLogger } from "@/lib/logger";
import { parsedQuestionToSavePayload } from "@/lib/question/parsed-question-payload";
import { runSerializedTransaction, serializeWrite } from "@/lib/db-write-queue";
import { prisma } from "@/lib/prisma";
import { mapAnalysisError, parseImageDataUrl, splitQuestionsForUser } from "@/lib/question/question-analysis";
import { batchDraftSchema, draftFromTextSplit, draftImageSchema, MAX_DRAFT_TEXT_LENGTH, MAX_ITEM_KNOWLEDGE_POINTS, newItemKey, readyItems } from "@/lib/question-split/draft";
import type { BatchDraft, DraftItem } from "@/lib/question-split/draft";
import { compactLines, composeQuestionInput, MAX_SPLIT_QUESTIONS, MAX_SPLIT_TEXT_LENGTH, splitQuestionText } from "@/lib/question-split/text";
import { normalizeQuestionType } from "@/lib/question/question-type";

const logger = createLogger('import-batches');

/** 整页图片与每题裁片 data URL 的最大长度（与单题上传一致） */
const MAX_IMAGE_DATA_LENGTH = 15 * 1024 * 1024;
const IMAGE_DATA_PATTERN = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
/** 列表中最多返回的已完成批次 */
const MAX_LISTED_DONE = 10;

const ACTIVE_TASK_STATUSES: ImportTaskStatus[] = ['analyzing', 'saving'];

const imageInfoSchema = z.object({
    sourceType: z.string().max(100).optional(),
    sourceBytes: z.number().nonnegative().max(1e9).optional(),
    sourceWidth: z.number().int().nonnegative().max(100_000).optional(),
    sourceHeight: z.number().int().nonnegative().max(100_000).optional(),
    outputWidth: z.number().int().nonnegative().max(100_000).optional(),
    outputHeight: z.number().int().nonnegative().max(100_000).optional(),
    outputBytes: z.number().nonnegative().max(1e9).optional(),
    decoder: z.enum(['native', 'heic']).optional(),
    quality: z.number().min(0).max(1).optional(),
}).strip();

/** 结构化题目条目（浏览器端解析题库文件后按草稿字段提交；宽松接受 null 与空串） */
const structuredItemSchema = z.object({
    text: z.string().max(MAX_DRAFT_TEXT_LENGTH),
    material: z.string().max(MAX_DRAFT_TEXT_LENGTH).nullish(),
    section: z.string().max(500).nullish(),
    label: z.string().max(20).nullish(),
    answer: z.string().max(MAX_DRAFT_TEXT_LENGTH).nullish(),
    analysis: z.string().max(MAX_DRAFT_TEXT_LENGTH).nullish(),
    knowledgePoints: z.array(z.string().max(200)).max(MAX_ITEM_KNOWLEDGE_POINTS).nullish(),
    difficultyStars: z.number().int().min(1).max(5).nullish(),
    wrongAnswer: z.string().max(MAX_DRAFT_TEXT_LENGTH).nullish(),
    questionType: z.string().max(100).nullish(),
    /** 题目原图 data URL（Word 内嵌图片或 JSON images 合成）；由草稿 schema 校验 */
    image: draftImageSchema.nullish(),
}).strip();

export const createImportBatchSchema = z.object({
    clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    source: z.enum(['text', 'image']),
    /** 文字批次：local 本地规则（不调用 AI）| ai 模型分题；图片批次始终由模型分题 */
    splitter: z.enum(['local', 'ai']).default('local'),
    /** 编号像小问时，用户明确选择仍按编号分题 */
    forceNumbered: z.boolean().optional(),
    text: z.string().optional(),
    /**
     * 结构化题目列表：与 text 互斥；条目按草稿字段校验。
     * 服务端直接构造草稿（不调用 AI、不计额度），供题库文件导入使用
     */
    items: z.array(structuredItemSchema).min(1).max(MAX_SPLIT_QUESTIONS).optional(),
    /** 结构化批次来源说明（文件名与格式） */
    origin: z.object({
        fileName: z.string().max(300).optional(),
        format: z.string().max(30).optional(),
    }).strip().optional(),
    imageBase64: z.string().max(MAX_IMAGE_DATA_LENGTH).regex(IMAGE_DATA_PATTERN).optional(),
    imageInfo: imageInfoSchema.optional(),
    language: z.enum(['zh', 'en']).default('zh'),
    subjectId: z.string().max(100).nullish(),
    targetSubjectId: z.string().max(100).nullish(),
    paperLevel: z.string().max(30).nullish(),
}).superRefine((input, context) => {
    if (input.source === 'text' && !input.text?.trim() && !input.items?.length) context.addIssue({ code: 'custom', path: ['text'], message: 'TEXT_REQUIRED' });
    if (input.source === 'text' && input.text?.trim() && input.items?.length) {
        context.addIssue({ code: 'custom', path: ['items'], message: 'ITEMS_TEXT_EXCLUSIVE' });
    }
    if (input.source === 'image' && !input.imageBase64) context.addIssue({ code: 'custom', path: ['imageBase64'], message: 'IMAGE_REQUIRED' });
    if (input.origin && !input.items?.length) context.addIssue({ code: 'custom', path: ['origin'], message: 'ORIGIN_REQUIRES_ITEMS' });
});

const updateDraftSchema = z.object({ version: z.number().int().min(1), draft: batchDraftSchema });

const startSchema = z.object({
    version: z.number().int().min(1),
    /** 图片批次：浏览器按各题区域从整页图裁剪出的图片 */
    images: z.array(z.object({
        key: z.string().max(40),
        imageBase64: z.string().max(MAX_IMAGE_DATA_LENGTH).regex(IMAGE_DATA_PATTERN),
        imageInfo: imageInfoSchema.optional(),
    })).max(60).optional(),
    /** 逐题解析方式：ai 调用 AI 识别（默认，行为与之前一致）；tags 保留草稿答案解析、AI 只补知识点/难度/题型；none 按原样入库（不调用 AI、不计额度）。仅文字批次可用 tags/none */
    analysis: z.enum(['ai', 'tags', 'none']).default('ai'),
});

/**
 * 批次读取默认不含整页图片（可能有几 MB）：状态轮询、列表与草稿保存都不从数据库读出原图，
 * 只有预览页明确取图（?include=image）或后台分题时才读取
 */
const batchSelect = {
    id: true, userId: true, clientRequestId: true, source: true, splitter: true, status: true, mode: true, language: true,
    subjectId: true, targetSubjectId: true, paperLevel: true, sourceText: true, imageInfo: true, draft: true, version: true,
    error: true, attempts: true, runnerId: true, heartbeatAt: true, readAt: true, startedAt: true, finishedAt: true,
    createdAt: true, updatedAt: true,
    tasks: { select: summarySelect },
} satisfies Prisma.ImportBatchSelect;
type BatchWithTasks = Prisma.ImportBatchGetPayload<{ select: typeof batchSelect }> & { imageData?: string };

function parseDraft(raw: string | null): BatchDraft | null {
    if (!raw) return null;
    try {
        const parsed = batchDraftSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

function countTasks(tasks: ImportTaskSummary[]): ImportBatchCounts {
    return {
        total: tasks.length,
        active: tasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status)).length,
        review: tasks.filter((task) => task.status === 'review').length,
        saved: tasks.filter((task) => task.status === 'saved').length,
        duplicate: tasks.filter((task) => task.status === 'saved' && task.duplicate).length,
        failed: tasks.filter((task) => task.status === 'failed').length,
    };
}

function toBatchSummary(batch: BatchWithTasks): { summary: ImportBatchSummary; draft: BatchDraft | null; tasks: ImportTaskSummary[] } {
    const draft = parseDraft(batch.draft);
    const order = new Map((draft?.items ?? []).map((item, index) => [item.key, index]));
    const tasks = batch.tasks.map(toSummary)
        .sort((a, b) => (order.get(a.batchItemKey ?? '') ?? 999) - (order.get(b.batchItemKey ?? '') ?? 999));
    const counts = countTasks(tasks);
    const status = batch.status as ImportBatchStatus;
    const phase = batchPhase(status, counts);
    const first = draft?.items.find((item) => item.selected) ?? draft?.items[0];
    const summary: ImportBatchSummary = {
        id: batch.id,
        source: batch.source as ImportBatchSource,
        splitter: batch.splitter as ImportBatchSplitter,
        status,
        phase,
        mode: batch.mode as ImportTaskMode | null,
        itemCount: draft?.items.length ?? 0,
        selectedCount: draft ? readyItems(draft, batch.source as ImportBatchSource).length : 0,
        counts,
        excerpt: first ? describeQuestion({ questionText: first.text || first.material || '' }) || null : null,
        error: batch.error,
        // 用户正在等待的结果出来后显示未读：分题完成或失败、各题处理结束
        unread: batch.readAt === null && phase !== 'splitting' && phase !== 'processing',
        attempts: batch.attempts,
        createdAt: batch.createdAt.toISOString(),
        startedAt: batch.startedAt?.toISOString() ?? null,
    };
    return { summary, draft, tasks };
}

function toDetail(batch: BatchWithTasks, options: { image?: boolean } = {}): ImportBatchDetail {
    const { summary, draft, tasks } = toBatchSummary(batch);
    return {
        ...summary,
        draft,
        tasks,
        version: batch.version,
        imageData: options.image ? batch.imageData || null : null,
        subjectId: batch.subjectId,
        targetSubjectId: batch.targetSubjectId,
        paperLevel: batch.paperLevel,
    };
}


/** 分题中但执行它的进程已不在：标记失败，可重试 */
async function reconcileInterrupted(userId: string, batchId?: string): Promise<void> {
    const splitting = await prisma.importBatch.findMany({
        where: { userId, ...(batchId ? { id: batchId } : {}), status: 'splitting' },
        select: { id: true, runnerId: true, heartbeatAt: true, updatedAt: true },
    });
    const now = Date.now();
    const interrupted = splitting.filter((batch) => isInterrupted(batch, now)).map((batch) => batch.id);
    if (interrupted.length === 0) return;
    await serializeWrite(() => prisma.importBatch.updateMany({
        where: { id: { in: interrupted }, status: 'splitting' },
        data: { status: 'failed', error: IMPORT_TASK_INTERRUPTED_ERROR, finishedAt: new Date(), readAt: null },
    }));
}

/** 所有题都已入库超过保留期的批次删除（错题不受影响） */
async function pruneDone(userId: string): Promise<void> {
    const cutoff = new Date(Date.now() - SAVED_IMPORT_TASK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await serializeWrite(() => prisma.importBatch.deleteMany({
        where: { userId, status: 'started', startedAt: { lt: cutoff }, tasks: { every: { status: 'saved', finishedAt: { lt: cutoff } } } },
    }));
}

async function findOwnBatch(user: Pick<User, 'id'>, id: string, image = false): Promise<BatchWithTasks | null> {
    await reconcileInterrupted(user.id, id);
    // 批次内正在解析或保存的题若因服务重启中断，同样标记为失败，批次页不会一直显示进行中
    await reconcileInterruptedTasks(user.id);
    return prisma.importBatch.findFirst({ where: { id, userId: user.id }, select: image ? { ...batchSelect, imageData: true } : batchSelect });
}

async function ownsNotebook(userId: string, subjectId: string | null | undefined): Promise<boolean> {
    if (!subjectId) return true;
    return (await prisma.subject.count({ where: { id: subjectId, userId } })) > 0;
}

/** 模型分题结果转为草稿：没有区域的图片题默认不选，等用户框选 */
function draftFromSplit(result: Awaited<ReturnType<typeof splitQuestionsForUser>>, source: ImportBatchSource): BatchDraft {
    const keys: string[] = [];
    return {
        items: result.questions.map((question): DraftItem => {
            const key = newItemKey(keys);
            keys.push(key);
            return {
                key,
                label: question.label,
                text: question.text,
                material: question.material,
                section: question.section,
                selected: source === 'image' ? question.regions.length > 0 : question.text.trim().length > 0,
                regions: question.regions,
                hasFigure: question.hasFigure,
                flags: question.flags,
            };
        }),
        ignored: result.ignored.slice(0, 200),
        warnings: result.warnings,
    };
}

/** 后台分题：结果写为草稿；没有识别到题目或出错时标记失败，可重试 */
async function runSplit(id: string): Promise<void> {
    const stopHeartbeat = startHeartbeat(id, 'batch');
    const started = Date.now();
    try {
        const batch = await prisma.importBatch.findUnique({ where: { id } });
        if (!batch || batch.status !== 'splitting') return;
        const source = batch.source as ImportBatchSource;
        const language = batch.language === 'en' ? 'en' : 'zh';
        let input: QuestionSplitInput;
        if (source === 'text') {
            // 创建时已确认不超过行数上限
            input = { kind: 'text', lines: compactLines(batch.sourceText ?? ''), language };
        } else {
            const { base64, mimeType } = parseImageDataUrl(batch.imageData);
            input = { kind: 'image', imageBase64: base64, mimeType: mimeType || 'image/jpeg', language };
        }
        let draft: BatchDraft;
        try {
            const result = await splitQuestionsForUser(batch.userId, input, `/import-batches/${id}`);
            if (result.questions.length === 0) throw new Error('SPLIT_NO_QUESTIONS');
            draft = draftFromSplit(result, source);
        } catch (error) {
            const message = getErrorMessage(error);
            const code = message === 'SPLIT_NO_QUESTIONS' ? message : mapAnalysisError(message);
            logger.warn({ batchId: id, error: code, splitMs: Date.now() - started }, 'Import batch split failed');
            await serializeWrite(() => prisma.importBatch.updateMany({
                where: { id, status: 'splitting' },
                data: { status: 'failed', error: code.slice(0, 200), finishedAt: new Date(), readAt: null },
            }));
            return;
        }
        await serializeWrite(() => prisma.importBatch.updateMany({
            where: { id, status: 'splitting' },
            data: { status: 'draft', draft: JSON.stringify(draft), version: { increment: 1 }, error: null, finishedAt: new Date(), readAt: null },
        }));
        logger.info({ batchId: id, source, questions: draft.items.length, warnings: draft.warnings, splitMs: Date.now() - started }, 'Import batch split');
    } finally {
        stopHeartbeat();
    }
}

type CreateResult = { response: NextResponse } | { batch: ImportBatchDetail; created: boolean };

/** 创建批次；同一幂等键重复提交时返回已有批次 */
export async function createImportBatch(user: User, raw: unknown): Promise<CreateResult> {
    const parsed = createImportBatchSchema.safeParse(raw);
    if (!parsed.success) return { response: validationError('IMPORT_BATCH_INVALID_INPUT', parsed.error.issues) };
    const input = parsed.data;
    const structuredItems = input.source === 'text' ? input.items ?? [] : [];
    // 超出上限的文字不截断处理，明确拒绝，由用户分次录入（结构化条目走客户端分批，不受单批文字上限限制）
    if (input.source === 'text' && !structuredItems.length
        && ((input.text?.length ?? 0) > MAX_SPLIT_TEXT_LENGTH || (input.splitter === 'ai' && compactLines(input.text ?? '').length > MAX_SPLIT_LINES))) {
        return { response: validationError('IMPORT_BATCH_TEXT_TOO_LONG', { maxLength: MAX_SPLIT_TEXT_LENGTH, maxLines: MAX_SPLIT_LINES }) };
    }

    const existing = await prisma.importBatch.findUnique({
        where: { userId_clientRequestId: { userId: user.id, clientRequestId: input.clientRequestId } },
        select: batchSelect,
    });
    if (existing) return { batch: toDetail(existing), created: false };
    if (!await ownsNotebook(user.id, input.subjectId) || !await ownsNotebook(user.id, input.targetSubjectId)) {
        return { response: validationError('IMPORT_TASK_INVALID_NOTEBOOK') };
    }

    const splitter: ImportBatchSplitter = input.source === 'image' ? 'ai' : input.splitter;
    let draft: BatchDraft | null = null;
    if (structuredItems.length > 0) {
        // 结构化题目直接构造草稿：不调用 AI、不计额度；题干非空默认选中
        const keys: string[] = [];
        draft = {
            items: structuredItems.map((item): DraftItem => {
                const key = newItemKey(keys);
                keys.push(key);
                return {
                    key,
                    label: item.label?.slice(0, 20) || null,
                    text: item.text.slice(0, MAX_DRAFT_TEXT_LENGTH),
                    material: item.material?.slice(0, MAX_DRAFT_TEXT_LENGTH) || null,
                    section: item.section?.slice(0, 500) || null,
                    selected: item.text.trim().length > 0,
                    regions: [],
                    hasFigure: false,
                    flags: [],
                    answer: item.answer?.slice(0, MAX_DRAFT_TEXT_LENGTH) || null,
                    analysis: item.analysis?.slice(0, MAX_DRAFT_TEXT_LENGTH) || null,
                    knowledgePoints: item.knowledgePoints?.slice(0, MAX_ITEM_KNOWLEDGE_POINTS),
                    difficultyStars: item.difficultyStars ?? null,
                    wrongAnswer: item.wrongAnswer?.slice(0, MAX_DRAFT_TEXT_LENGTH) || null,
                    questionType: normalizeQuestionType(item.questionType),
                    image: item.image ?? null,
                };
            }),
            ignored: [],
            warnings: [],
        };
        if (draft.items.length === 0) return { response: validationError('IMPORT_BATCH_EMPTY') };
    } else if (splitter === 'local') {
        const split = splitQuestionText(input.text ?? '', { forceNumbered: input.forceNumbered });
        if (split.questions.length === 0) return { response: validationError('IMPORT_BATCH_EMPTY') };
        draft = draftFromTextSplit(split.questions, split.ignored, split.overflow);
    }

    const id = randomUUID().replace(/-/g, '');
    const release = splitter === 'ai' ? register(id) : () => undefined;
    // 结构化批次：sourceText 存可读的拼接文本或文件名说明（不超现有列的合理长度）
    let sourceText = input.source === 'text' ? input.text ?? null : null;
    if (structuredItems.length > 0) {
        if (input.origin?.fileName) {
            sourceText = `文件导入：${input.origin.fileName}${input.origin.format ? `（${input.origin.format}）` : ''}`;
        } else {
            const excerpt = structuredItems[0].text.trim().slice(0, 100);
            sourceText = excerpt ? `${structuredItems.length} 道结构化题目：${excerpt}${structuredItems.length > 1 ? '…' : ''}` : null;
        }
    }
    let batch: BatchWithTasks;
    try {
        batch = await serializeWrite(() => prisma.importBatch.create({
            data: {
                id,
                userId: user.id,
                clientRequestId: input.clientRequestId,
                source: input.source,
                splitter,
                status: draft ? 'draft' : 'splitting',
                language: input.language,
                subjectId: input.subjectId || null,
                targetSubjectId: input.targetSubjectId || null,
                paperLevel: input.paperLevel || null,
                sourceText,
                imageData: input.imageBase64 ?? '',
                imageInfo: input.imageInfo ? JSON.stringify(input.imageInfo) : null,
                draft: draft ? JSON.stringify(draft) : null,
                runnerId: bootId(),
                heartbeatAt: new Date(),
                // 本地分题由用户当场发起、立即查看，不显示未读
                readAt: draft ? new Date() : null,
                finishedAt: draft ? new Date() : null,
            },
            select: batchSelect,
        }));
    } catch (error) {
        release();
        if ((error as { code?: string }).code === 'P2002') {
            const winner = await prisma.importBatch.findUnique({
                where: { userId_clientRequestId: { userId: user.id, clientRequestId: input.clientRequestId } },
                select: batchSelect,
            });
            if (winner) return { batch: toDetail(winner), created: false };
        }
        throw error;
    }

    if (splitter === 'ai') {
        // 创建成功后才计额度；超额时批次标记失败，可次日重试或丢弃
        const limited = await serializeWrite(() => consumeAiQuota(user, 'split'));
        if (limited) {
            release();
            const rejection = await quotaRejectionCode(limited);
            await serializeWrite(() => prisma.importBatch.updateMany({ where: { id, status: 'splitting' }, data: { status: 'failed', error: rejection, finishedAt: new Date() } }));
            return { response: limited };
        }
        scheduleWork(id, release, () => runSplit(id));
    }
    logger.info({ batchId: id, source: input.source, splitter, questions: draft?.items.length ?? null }, 'Import batch created');
    return { batch: toDetail(batch), created: true };
}

export async function getImportBatch(user: Pick<User, 'id'>, id: string, options: { image?: boolean } = {}): Promise<ImportBatchDetail | null> {
    const batch = await findOwnBatch(user, id, options.image === true);
    return batch ? toDetail(batch, options) : null;
}

function conflict(code: string, batch?: BatchWithTasks): NextResponse {
    return createErrorResponse(code, 409, ErrorCode.CONFLICT, batch ? { batch: toDetail(batch) } : undefined);
}

/** 保存草稿；版本号不一致时返回 409 与最新草稿，由前端提示后载入 */
export async function updateImportBatchDraft(user: Pick<User, 'id'>, id: string, raw: unknown): Promise<NextResponse> {
    const parsed = updateDraftSchema.safeParse(raw);
    if (!parsed.success) return validationError('IMPORT_BATCH_INVALID_DRAFT', parsed.error.issues);
    const updated = await serializeWrite(() => prisma.importBatch.updateMany({
        where: { id, userId: user.id, status: 'draft', version: parsed.data.version },
        data: { draft: JSON.stringify(parsed.data.draft), version: { increment: 1 } },
    }));
    const batch = await findOwnBatch(user, id);
    if (!batch) return notFound('IMPORT_BATCH_NOT_FOUND');
    if (updated.count === 0) return conflict(batch.status === 'draft' ? 'IMPORT_BATCH_VERSION_CONFLICT' : 'IMPORT_BATCH_NOT_EDITABLE', batch);
    return NextResponse.json({ batch: toDetail(batch) });
}

/**
 * 开始解析已选的题：抢占草稿状态后一次建出全部任务。重复或并发提交时只有一次生效，其余返回同一批次。
 * 图片批次需附带每道已选题的裁片。
 */
export async function startImportBatch(user: User, id: string, raw: unknown): Promise<NextResponse> {
    const parsed = startSchema.safeParse(raw);
    if (!parsed.success) return validationError('IMPORT_BATCH_INVALID_INPUT', parsed.error.issues);
    const batch = await findOwnBatch(user, id);
    if (!batch) return notFound('IMPORT_BATCH_NOT_FOUND');
    if (batch.status === 'started') return NextResponse.json({ batch: toDetail(batch), alreadyStarted: true });
    if (batch.status !== 'draft') return conflict('IMPORT_BATCH_NOT_EDITABLE', batch);
    if (batch.version !== parsed.data.version) return conflict('IMPORT_BATCH_VERSION_CONFLICT', batch);
    const draft = parseDraft(batch.draft);
    const source = batch.source as ImportBatchSource;
    const items = draft ? readyItems(draft, source) : [];
    if (items.length === 0) return validationError('IMPORT_BATCH_EMPTY');

    const images = new Map((parsed.data.images ?? []).map((image) => [image.key, image]));
    if (source === 'image') {
        if (items.some((item) => !images.has(item.key))) return validationError('IMPORT_BATCH_IMAGE_MISSING');
        const total = items.reduce((sum, item) => sum + images.get(item.key)!.imageBase64.length, 0);
        if (total > MAX_START_IMAGES_LENGTH) return validationError('IMPORT_BATCH_TOO_LARGE');
    }
    if (source === 'text') {
        // 文字批次：草稿中的题目原图总长度沿用批次图片总上限
        const total = items.reduce((sum, item) => sum + (item.image?.length ?? 0), 0);
        if (total > MAX_START_IMAGES_LENGTH) return validationError('IMPORT_BATCH_TOO_LARGE');
    }
    if (!await ownsNotebook(user.id, batch.targetSubjectId)) return validationError('IMPORT_TASK_INVALID_NOTEBOOK');

    const mode: ImportTaskMode = user.confirmBeforeImport ? 'review' : 'auto';
    const planned = items.map((item) => ({ item, id: randomUUID().replace(/-/g, '') }));

    const analysis = parsed.data.analysis;
    if (analysis === 'none' || analysis === 'tags') {
        if (source !== 'text') return validationError('IMPORT_BATCH_ANALYSIS_NONE_TEXT_ONLY');
        const targetNotebookId = batch.targetSubjectId ?? batch.subjectId;
        if (!targetNotebookId) return validationError('IMPORT_BATCH_ANALYSIS_NONE_TARGET_REQUIRED');
        const targetNotebook = await prisma.subject.findFirst({ where: { id: targetNotebookId, userId: user.id }, select: { name: true } });
        if (!targetNotebook) return validationError('IMPORT_TASK_INVALID_NOTEBOOK');
        const results = new Map(planned.map(({ item, id: taskId }) => [taskId, draftItemToParsed(item, { notebookName: targetNotebook.name })]));
        const invalid = planned.find(({ id: taskId }) => !results.get(taskId));
        if (invalid) {
            logger.error({ batchId: id, key: invalid.item.key }, 'Import batch start failed: draft item cannot be converted to parsed question');
            return createErrorResponse('IMPORT_BATCH_START_FAILED', 500, ErrorCode.INTERNAL_ERROR);
        }
        return await startWithDraftResults(user, batch, planned, results as Map<string, NonNullable<ReturnType<typeof draftItemToParsed>>>, mode, targetNotebookId, analysis);
    }

    const releases = new Map(planned.map(({ id: taskId }) => [taskId, register(taskId)]));
    const releaseAll = () => releases.forEach((release) => release());
    try {
        await runSerializedTransaction(async (tx) => {
            const claimed = await tx.importBatch.updateMany({
                where: { id, userId: user.id, status: 'draft', version: parsed.data.version },
                data: { status: 'started', mode, startedAt: new Date(), readAt: new Date(), error: null },
            });
            if (claimed.count === 0) throw new Error('IMPORT_BATCH_ALREADY_CLAIMED');
            const now = new Date();
            for (const { item, id: taskId } of planned) {
                const image = images.get(item.key);
                await tx.importTask.create({
                    data: {
                        id: taskId,
                        userId: user.id,
                        clientRequestId: taskId,
                        mode,
                        status: 'analyzing',
                        language: batch.language,
                        subjectId: batch.subjectId,
                        targetSubjectId: batch.targetSubjectId,
                        paperLevel: batch.paperLevel,
                        // ai 模式：图片批次按图片识别；文字批次带原图的题按图片识别（文字层作参考），纯文字题按文字识别
                        imageData: source === 'image' ? image!.imageBase64 : (item.image ?? ''),
                        imageInfo: image?.imageInfo ? JSON.stringify(image.imageInfo) : null,
                        inputText: source === 'text' ? composeQuestionInput(item) : null,
                        batchId: id,
                        batchItemKey: item.key,
                        timings: JSON.stringify({ client: {}, server: {} }),
                        runnerId: bootId(),
                        heartbeatAt: now,
                    },
                });
            }
        });
    } catch (error) {
        releaseAll();
        if (getErrorMessage(error) === 'IMPORT_BATCH_ALREADY_CLAIMED') {
            const current = await findOwnBatch(user, id);
            if (!current) return notFound('IMPORT_BATCH_NOT_FOUND');
            if (current.status === 'started') return NextResponse.json({ batch: toDetail(current), alreadyStarted: true });
            return conflict('IMPORT_BATCH_VERSION_CONFLICT', current);
        }
        // 事务已整体回滚：批次仍是草稿，没有建出任务，也没有调用 AI 或计额度
        logger.error({ batchId: id, error: getErrorMessage(error) }, 'Import batch start failed');
        return createErrorResponse('IMPORT_BATCH_START_FAILED', 500, ErrorCode.INTERNAL_ERROR);
    }

    // 抢占成功、任务已建出后逐题计额度；带原图的题按图片识别计 analyze 额度，纯文字题按 reanswer 计
    for (const { item, id: taskId } of planned) {
        const release = releases.get(taskId)!;
        const imageData = source === 'image' ? images.get(item.key)!.imageBase64 : (item.image ?? '');
        const limited = await serializeWrite(() => consumeAiQuota(user, quotaKindOf({ inputText: source === 'text' ? composeQuestionInput(item) : null, imageData })));
        if (limited) {
            release();
            await markFailed(taskId, 'analyzing', await quotaRejectionCode(limited));
            continue;
        }
        scheduleImportTask(taskId, release);
    }
    logger.info({ batchId: id, source, mode, questions: planned.length }, 'Import batch started');
    const current = await findOwnBatch(user, id);
    return NextResponse.json({ batch: toDetail(current!) }, { status: 202 });
}

type PlannedTask = { item: DraftItem; id: string };
type ParsedResultMap = Map<string, ParsedQuestion>;

/**
 * 「按原样入库」（analysis='none'）与「AI 只补标签」（analysis='tags'）共用：
 * 先用草稿字段构造识别结果写入 task.result，再按解析方式决定任务初始状态与后续处理。
 *
 * analysis='none'：任务直接以终态创建（review 或 saving），不调用 AI、不计额度；
 *   saving 任务安排后台保存（executeTask 对 saving 任务跳过识别直接保存）。
 * analysis='tags'：任务以 analyzing 状态创建；executeTask 检测到已有结果时仅调用 AI 补全缺失的
 *   知识点、难度星级与题型（不重新完整识别），每题计一次 retag 额度。
 *   已有值的字段保留；AI 失败或超额时按原结果继续入库（不失败）。
 *
 * 两种方式的 targetSubjectId 都固定为目标错题本（targetSubjectId ?? subjectId），
 * 保证自动入库（autoSavePayload 只看 task.targetSubjectId）落到正确错题本。
 */
async function startWithDraftResults(
    user: User,
    batch: BatchWithTasks,
    planned: PlannedTask[],
    results: ParsedResultMap,
    mode: ImportTaskMode,
    targetNotebookId: string,
    analysis: 'none' | 'tags',
): Promise<NextResponse> {
    const initialStatus: ImportTaskStatus = analysis === 'none'
        ? (mode === 'review' ? 'review' : 'saving')
        : 'analyzing';
    const releases = new Map(planned.map(({ id: taskId }) => [taskId, register(taskId)]));
    const releaseAll = () => releases.forEach((release) => release());
    try {
        await runSerializedTransaction(async (tx) => {
            const claimed = await tx.importBatch.updateMany({
                where: { id: batch.id, userId: user.id, status: 'draft', version: batch.version },
                data: { status: 'started', mode, startedAt: new Date(), readAt: new Date(), error: null },
            });
            if (claimed.count === 0) throw new Error('IMPORT_BATCH_ALREADY_CLAIMED');
            const now = new Date();
            for (const { item, id: taskId } of planned) {
                const result = results.get(taskId)!;
                await tx.importTask.create({
                    data: {
                        id: taskId,
                        userId: user.id,
                        clientRequestId: taskId,
                        mode,
                        status: initialStatus,
                        language: batch.language,
                        subjectId: batch.subjectId,
                        targetSubjectId: targetNotebookId,
                        paperLevel: batch.paperLevel,
                        imageData: item.image ?? '',
                        inputText: null,
                        result: JSON.stringify(result),
                        batchId: batch.id,
                        batchItemKey: item.key,
                        timings: JSON.stringify({ client: {}, server: {} }),
                        runnerId: bootId(),
                        heartbeatAt: now,
                        ...(initialStatus === 'review' ? { finishedAt: now, readAt: null } : {}),
                    },
                });
            }
        });
    } catch (error) {
        releaseAll();
        if (getErrorMessage(error) === 'IMPORT_BATCH_ALREADY_CLAIMED') {
            const current = await findOwnBatch(user, batch.id);
            if (!current) return notFound('IMPORT_BATCH_NOT_FOUND');
            if (current.status === 'started') return NextResponse.json({ batch: toDetail(current), alreadyStarted: true });
            return conflict('IMPORT_BATCH_VERSION_CONFLICT', current);
        }
        logger.error({ batchId: batch.id, error: getErrorMessage(error) }, `Import batch start (${analysis}) failed`);
        return createErrorResponse('IMPORT_BATCH_START_FAILED', 500, ErrorCode.INTERNAL_ERROR);
    }

    if (analysis === 'none') {
        // 不计 AI 额度；自动入库的任务直接安排后台保存（saving 任务跳过识别）
        for (const { id: taskId } of planned) {
            if (mode !== 'review') scheduleImportTask(taskId, releases.get(taskId)!);
            else releases.get(taskId)!();
        }
        logger.info({ batchId: batch.id, mode, questions: planned.length }, 'Import batch started (no analysis)');
    } else {
        // 每题计一次 retag 额度；超额的题不调用 AI、不标记失败，
        // 直接把任务从 analyzing 推进到与正常完成识别后相同的下一状态（结果保持原样）
        for (const { id: taskId } of planned) {
            const release = releases.get(taskId)!;
            const limited = await serializeWrite(() => consumeAiQuota(user, 'retag'));
            if (limited) {
                release();
                const next: ImportTaskStatus = mode === 'auto' ? 'saving' : 'review';
                await serializeWrite(() => prisma.importTask.updateMany({
                    where: { id: taskId, status: 'analyzing' },
                    data: {
                        status: next,
                        error: null,
                        heartbeatAt: new Date(),
                        ...(next === 'review' ? { finishedAt: new Date(), readAt: null } : {}),
                    },
                }));
                if (next === 'saving') scheduleImportTask(taskId, register(taskId));
                continue;
            }
            scheduleImportTask(taskId, release);
        }
        logger.info({ batchId: batch.id, mode, questions: planned.length }, 'Import batch started (tags only)');
    }
    const current = await findOwnBatch(user, batch.id);
    return NextResponse.json({ batch: toDetail(current!) }, { status: 202 });
}

/**
 * 重试：分题失败时重新分题（计一次额度）；已开始的批次只重试失败的题，
 * 已有识别结果的题只重试保存，不重新调用 AI。
 */
export async function retryImportBatch(user: User, id: string): Promise<NextResponse> {
    const batch = await findOwnBatch(user, id);
    if (!batch) return notFound('IMPORT_BATCH_NOT_FOUND');
    if (batch.status === 'failed') {
        const sourceAvailable = batch.source === 'image'
            ? (await prisma.importBatch.count({ where: { id, imageData: { not: '' } } })) > 0
            : !!batch.sourceText;
        if (!sourceAvailable) {
            return createErrorResponse('IMPORT_BATCH_NOT_RETRYABLE', 409, ErrorCode.CONFLICT);
        }
        const release = register(id);
        const claimed = await serializeWrite(() => prisma.importBatch.updateMany({
            where: { id, userId: user.id, status: 'failed' },
            data: { status: 'splitting', error: null, attempts: { increment: 1 }, runnerId: bootId(), heartbeatAt: new Date(), finishedAt: null },
        }));
        if (claimed.count === 0) {
            release();
        } else {
            const limited = await serializeWrite(() => consumeAiQuota(user, 'split'));
            if (limited) {
                release();
                const rejection = await quotaRejectionCode(limited);
                await serializeWrite(() => prisma.importBatch.updateMany({ where: { id, status: 'splitting' }, data: { status: 'failed', error: rejection, finishedAt: new Date() } }));
                return limited;
            }
            scheduleWork(id, release, () => runSplit(id));
        }
    } else if (batch.status === 'started') {
        const failed = batch.tasks.filter((task) => task.status === 'failed');
        if (failed.length === 0) return createErrorResponse('IMPORT_BATCH_NOTHING_TO_RETRY', 409, ErrorCode.CONFLICT);
        for (const task of failed) {
            const response = await retryImportTask(user, task.id);
            if (response.status === 429) return response;
        }
    } else {
        return createErrorResponse('IMPORT_BATCH_NOT_RETRYABLE', 409, ErrorCode.CONFLICT, { status: batch.status });
    }
    logger.info({ batchId: id, status: batch.status }, 'Import batch retried');
    const current = await findOwnBatch(user, id);
    return NextResponse.json({ batch: toDetail(current!) }, { status: 202 });
}

/** 校对模式下，按识别结果直接入库其余待校对的题（逐题保存，已保存的不重复） */
export async function confirmAllImportBatch(user: User, id: string): Promise<NextResponse> {
    const batch = await findOwnBatch(user, id);
    if (!batch) return notFound('IMPORT_BATCH_NOT_FOUND');
    const pending = await prisma.importTask.findMany({
        where: { batchId: id, userId: user.id, status: 'review' },
        select: { id: true, result: true, targetSubjectId: true, paperLevel: true },
    });
    let saved = 0;
    const failed: string[] = [];
    for (const task of pending) {
        const result = parseResult(task.result);
        if (!result) {
            failed.push(task.id);
            continue;
        }
        // 图片使用任务中保存的原图，请求中的 originalImageUrl 会被忽略
        const response = await confirmImportTask(user, task.id, parsedQuestionToSavePayload(result, { subjectId: task.targetSubjectId, paperLevel: task.paperLevel }));
        if (response.ok) saved++;
        else failed.push(task.id);
    }
    logger.info({ batchId: id, saved, failed: failed.length }, 'Import batch confirmed all');
    const current = await findOwnBatch(user, id);
    return NextResponse.json({ batch: toDetail(current!), saved, failed: failed.length });
}

/** 丢弃批次（含未入库的任务记录）；有题正在保存时不允许。已入库的错题不受影响 */
export async function discardImportBatch(user: Pick<User, 'id'>, id: string): Promise<NextResponse> {
    const batch = await findOwnBatch(user, id);
    if (!batch) return notFound('IMPORT_BATCH_NOT_FOUND');
    if (batch.tasks.some((task) => task.status === 'saving')) return createErrorResponse('IMPORT_TASK_BUSY', 409, ErrorCode.CONFLICT);
    await serializeWrite(() => prisma.importBatch.deleteMany({ where: { id, userId: user.id, tasks: { none: { status: 'saving' } } } }));
    return NextResponse.json({ success: true });
}

export async function markImportBatchRead(user: Pick<User, 'id'>, id: string): Promise<boolean> {
    const updated = await serializeWrite(() => prisma.importBatch.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } }));
    if (updated.count > 0) return true;
    return (await prisma.importBatch.count({ where: { id, userId: user.id } })) > 0;
}

/** 当前用户的批次摘要：未完成的全部返回，已完成的返回最近若干个 */
export async function listImportBatches(user: Pick<User, 'id'>): Promise<ImportBatchSummary[]> {
    await reconcileInterrupted(user.id);
    await pruneDone(user.id);
    // 未完成的批次（草稿、分题中/失败、仍有题未入库）全部返回，不会被较新的已完成批次挤出列表；
    // 全部入库的批次只返回最近若干个
    const [unfinished, done] = await Promise.all([
        prisma.importBatch.findMany({
            where: { userId: user.id, OR: [{ status: { not: 'started' } }, { tasks: { some: { status: { not: 'saved' } } } }] },
            select: batchSelect,
            orderBy: { createdAt: 'desc' },
        }),
        prisma.importBatch.findMany({
            where: { userId: user.id, status: 'started', tasks: { every: { status: 'saved' } } },
            select: batchSelect,
            orderBy: { createdAt: 'desc' },
            take: MAX_LISTED_DONE,
        }),
    ]);
    return [...unfinished, ...done]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((batch) => toBatchSummary(batch).summary);
}

/** 识别任务中心：单独上传的任务与多题批次，执行中数与未读数都包含批次 */
export async function listImportCenter(user: Pick<User, 'id'>) {
    const [tasks, batches] = await Promise.all([listImportTasks(user), listImportBatches(user)]);
    return {
        ...tasks,
        batches,
        activeCount: tasks.activeCount + batches.filter((batch) => batch.phase === 'splitting' || batch.phase === 'processing').length,
        unreadCount: tasks.unreadCount + batches.filter((batch) => batch.unread).length,
    };
}

/** 仅供测试 */
export async function waitForImportBatchTasksForTest(id: string): Promise<void> {
    const { waitForImportTaskForTest } = await import("@/lib/import/import-tasks");
    await waitForImportTaskForTest(id);
    const tasks = await prisma.importTask.findMany({ where: { batchId: id }, select: { id: true } });
    await Promise.all(tasks.map((task) => waitForImportTaskForTest(task.id)));
}
