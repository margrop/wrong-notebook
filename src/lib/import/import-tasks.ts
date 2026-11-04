/**
 * 拍照识别导入任务（服务端持久化）。
 *
 * 上传成功即创建任务并返回编号，识别和入库在服务端后台执行，不依赖发起页面的连接：
 * 手机锁屏、切换应用或离开页面后，回来仍能从任务列表取回同一结果，不会重新调用 AI。
 *
 * - 「导入前人工确认」开启时（mode=review），识别结果作为待校对草稿保存，用户确认后入库；
 *   关闭时（mode=auto）识别完成后直接入库，沿用「添加错题」接口的验证、判重与年级/卷别规则。
 * - 状态：analyzing 识别中 → review 待校对 / saving 保存中 → saved 已保存；任一步出错为 failed，可重试。
 *   状态迁移都用带条件的 updateMany 抢占，重复请求或重复确认不会重复入库。
 * - 服务重启后，执行中的任务按启动编号判断为已中断并标记失败（SERVER_RESTARTED），不会显示为仍在执行；
 *   多实例部署（Vercel）时按心跳超时判断。
 * - 待校对与失败的任务一直保留到用户处理或丢弃；已保存的任务保留 7 天，入库后清空图片（原图已在错题中）。
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import type { ImportTask, Prisma, User } from "@prisma/client";
import { z } from "zod";
import { ParsedQuestionSchema } from "@/lib/ai/schema";
import type { ParsedQuestion } from "@/lib/ai";
import { consumeAiQuota } from "@/lib/ai-quota";
import { createErrorResponse, ErrorCode, notFound, validationError } from "@/lib/api-errors";
import { describeQuestion } from "@/lib/background-tasks";
import { getErrorMessage } from "@/lib/error-message";
import { CLIENT_TIMING_KEYS, IMPORT_TASK_INTERRUPTED_ERROR, SAVED_IMPORT_TASK_RETENTION_DAYS } from "@/lib/import/import-task-types";
import type {
    ImportTaskDetail, ImportTaskListResponse, ImportTaskMode, ImportTaskStatus, ImportTaskSummary, ImportTaskTimings,
} from "@/lib/import/import-task-types";
import { createLogger } from "@/lib/logger";
import { parsedQuestionToSavePayload } from "@/lib/question/parsed-question-payload";
import { serializeWrite } from "@/lib/db-write-queue";
import { prisma } from "@/lib/prisma";
import { analyzeQuestionForUser, analyzeQuestionTextForUser, mapAnalysisError } from "@/lib/question/question-analysis";
import { importSchema, saveQuestion } from "@/lib/question/question-save";
import type { SaveQuestionResult } from "@/lib/question/question-save";
import { questionSaveFailureToResponse } from "@/lib/question/question-save-response";
import type { QuestionSaveFailure } from "@/lib/question/question-save-failure";

const logger = createLogger('import-tasks');

/** 执行中刷新心跳的间隔 */
const HEARTBEAT_MS = 15_000;
/** 多实例部署时心跳超过此时长视为中断 */
const STALE_HEARTBEAT_MS = 90_000;
/** 列表最多返回的已结束任务数（待校对与失败的任务全部返回） */
const MAX_LISTED_SAVED = 20;
/** 题目图片 data URL 的最大长度（约 11MB 图片） */
const MAX_IMAGE_DATA_LENGTH = 15 * 1024 * 1024;

// 本进程的启动编号：任务记录执行它的进程，进程不同即说明执行该任务的服务已重启
const runtime = globalThis as typeof globalThis & {
    __importTaskBootId?: string;
    __importTaskRunning?: Map<string, Set<symbol>>;
    __importTaskInflight?: Map<string, Promise<void>>;
};
/** 本进程的启动编号（测试中可更换以模拟重启） */
export function bootId(): string {
    return runtime.__importTaskBootId ??= randomUUID();
}
/**
 * 本进程正在执行的任务：每次执行（识别、保存）登记一个独立令牌，结束时只移除自己的令牌，
 * 抢占失败的并发请求不会移除获胜者的登记。
 */
const running: Map<string, Set<symbol>> = runtime.__importTaskRunning ??= new Map();

function isRunningHere(id: string): boolean {
    return (running.get(id)?.size ?? 0) > 0;
}

/** 登记一次执行，返回释放函数（只释放本次登记，可重复调用） */
export function register(id: string): () => void {
    const token = Symbol(id);
    const tokens = running.get(id) ?? new Set<symbol>();
    tokens.add(token);
    running.set(id, tokens);
    return () => {
        const current = running.get(id);
        if (!current) return;
        current.delete(token);
        if (current.size === 0) running.delete(id);
    };
}
const inflight: Map<string, Promise<void>> = runtime.__importTaskInflight ??= new Map();

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

const timingValue = z.number().nonnegative().max(3_600_000);

export const createImportTaskSchema = z.object({
    clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    imageBase64: z.string().max(MAX_IMAGE_DATA_LENGTH).regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/),
    language: z.enum(['zh', 'en']).default('zh'),
    subjectId: z.string().max(100).nullish(),
    targetSubjectId: z.string().max(100).nullish(),
    paperLevel: z.string().max(30).nullish(),
    /** 一图多题批量导入始终直接入库 */
    mode: z.literal('auto').optional(),
    imageInfo: imageInfoSchema.optional(),
    clientTimings: z.object(Object.fromEntries(CLIENT_TIMING_KEYS.map((key) => [key, timingValue.optional()]))).strip().optional(),
});

/** 校对页提交的内容：图片使用任务中保存的原图，不接受前端替换 */
const confirmSchema = importSchema.omit({ originalImageUrl: true });

function parseJson<T>(raw: string | null, fallback: T): T {
    if (!raw) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

export function parseResult(raw: string | null): ParsedQuestion | null {
    const parsed = ParsedQuestionSchema.safeParse(parseJson<unknown>(raw, null));
    return parsed.success ? parsed.data : null;
}

function mergeTimings(raw: string | null, patch: ImportTaskTimings): string {
    const current = parseJson<ImportTaskTimings>(raw, {});
    return JSON.stringify({
        client: { ...current.client, ...patch.client },
        server: { ...current.server, ...patch.server },
    });
}

export type TaskWithItem = ImportTask & { errorItem: { shortId: string | null; subject: { name: string } | null } | null };
export const withItem = { errorItem: { select: { shortId: true, subject: { select: { name: true } } } } } satisfies Prisma.ImportTaskInclude;
/** 列表轮询只读取元数据，不加载题目图片 */
export const summarySelect = {
    id: true, status: true, mode: true, subjectId: true, targetSubjectId: true, result: true, error: true, batchId: true, batchItemKey: true,
    errorItemId: true, duplicate: true, readAt: true, attempts: true, timings: true, createdAt: true, finishedAt: true,
    ...withItem,
} satisfies Prisma.ImportTaskSelect;
type SummaryRow = Prisma.ImportTaskGetPayload<{ select: typeof summarySelect }>;

export function toSummary(task: SummaryRow): ImportTaskSummary {
    const result = parseResult(task.result);
    const status = task.status as ImportTaskStatus;
    return {
        id: task.id,
        status,
        mode: task.mode as ImportTaskMode,
        subjectId: task.subjectId,
        targetSubjectId: task.targetSubjectId,
        excerpt: result ? describeQuestion({ questionText: result.questionText }) : null,
        batchId: task.batchId,
        batchItemKey: task.batchItemKey,
        error: task.error,
        errorItemId: task.errorItemId,
        errorItemShortId: task.errorItem?.shortId ?? null,
        notebookName: task.errorItem?.subject?.name ?? null,
        duplicate: task.duplicate,
        hasResult: result !== null,
        unread: task.readAt === null && (status === 'review' || status === 'saved' || status === 'failed'),
        attempts: task.attempts,
        timings: parseJson<ImportTaskTimings>(task.timings, {}),
        createdAt: task.createdAt.toISOString(),
        finishedAt: task.finishedAt?.toISOString() ?? null,
    };
}

/** 任务详情：题目图片只在明确需要（进入校对页）时返回，状态轮询与创建响应不重复传输整张图片 */
function toDetail(task: SummaryRow & { paperLevel: string | null; imageData?: string }, options: { image?: boolean } = {}): ImportTaskDetail {
    return {
        ...toSummary(task),
        result: parseResult(task.result),
        imageData: options.image ? task.imageData || null : null,
        paperLevel: task.paperLevel,
    };
}

export function isInterrupted(task: { id: string; runnerId: string | null; heartbeatAt: Date | null; updatedAt: Date }, now: number): boolean {
    if (task.runnerId === bootId()) return !isRunningHere(task.id);
    // 多实例部署时其他实例可能仍在执行，按心跳判断；单进程部署时启动编号不同即已重启
    if (process.env.VERCEL) return now - (task.heartbeatAt ?? task.updatedAt).getTime() > STALE_HEARTBEAT_MS;
    return true;
}

/** 把已中断的执行中任务标记为失败，保留已有的识别结果供重试（批次页读取时也会调用） */
export async function reconcileInterrupted(userId: string, taskId?: string): Promise<void> {
    const active = await prisma.importTask.findMany({
        where: { userId, ...(taskId ? { id: taskId } : {}), status: { in: ['analyzing', 'saving'] } },
        select: { id: true, runnerId: true, heartbeatAt: true, updatedAt: true },
    });
    const now = Date.now();
    const interrupted = active.filter((task) => isInterrupted(task, now)).map((task) => task.id);
    if (interrupted.length === 0) return;
    await serializeWrite(() => prisma.importTask.updateMany({
        where: { id: { in: interrupted }, status: { in: ['analyzing', 'saving'] } },
        data: { status: 'failed', error: IMPORT_TASK_INTERRUPTED_ERROR, finishedAt: new Date(), readAt: null },
    }));
    logger.info({ userId, count: interrupted.length }, 'Marked interrupted import tasks as failed');
}

/** 删除超过保留期的已保存独立任务；批次中的任务随批次一起保留或清理，不单独删除 */
async function pruneSaved(userId: string): Promise<void> {
    const cutoff = new Date(Date.now() - SAVED_IMPORT_TASK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await serializeWrite(() => prisma.importTask.deleteMany({ where: { userId, batchId: null, status: 'saved', finishedAt: { lt: cutoff } } }));
}

async function findOwnTask(user: Pick<User, 'id'>, id: string): Promise<TaskWithItem | null> {
    await reconcileInterrupted(user.id, id);
    return prisma.importTask.findFirst({ where: { id, userId: user.id }, include: withItem });
}

/** 错题本须属于当前用户 */
async function ownsNotebook(userId: string, subjectId: string | null | undefined): Promise<boolean> {
    if (!subjectId) return true;
    return (await prisma.subject.count({ where: { id: subjectId, userId } })) > 0;
}

export function startHeartbeat(id: string, model: 'task' | 'batch' = 'task'): () => void {
    const timer = setInterval(() => {
        const where = { id, runnerId: bootId() };
        const data = { heartbeatAt: new Date() };
        (model === 'batch' ? serializeWrite(() => prisma.importBatch.updateMany({ where, data })) : serializeWrite(() => prisma.importTask.updateMany({ where, data })))
            .catch((error: unknown) => logger.warn({ id, model, error: getErrorMessage(error) }, 'Import heartbeat failed'));
    }, HEARTBEAT_MS);
    timer.unref?.();
    return () => clearInterval(timer);
}

/**
 * 安排后台执行：在请求上下文中用 after() 保证响应返回后继续执行（含 Vercel），否则直接执行。
 * release 为调用方抢占成功前已登记的执行令牌，执行结束后释放。
 * 后台执行只使用任务中记录的用户编号从数据库读取用户，不读取请求的 Cookie 或会话。
 */
function schedule(id: string, release: () => void, work: () => Promise<void>): void {
    scheduleWork(id, release, work);
}

/** 在后台执行一项工作（任务或批次分题）；inflight 以 id 记录，供测试等待 */
export function scheduleWork(id: string, release: () => void, work: () => Promise<void>): void {
    const run = () => {
        const promise = work()
            .catch((error: unknown) => logger.error({ taskId: id, error: getErrorMessage(error) }, 'Import task crashed'))
            .finally(() => {
                release();
                inflight.delete(id);
            });
        inflight.set(id, promise);
        return promise;
    };
    try {
        after(run);
    } catch {
        void run();
    }
}

export async function markFailed(id: string, fromStatus: ImportTaskStatus, error: string): Promise<void> {
    await serializeWrite(() => prisma.importTask.updateMany({
        where: { id, status: fromStatus },
        data: { status: 'failed', error: error.slice(0, 200), finishedAt: new Date(), readAt: null },
    }));
}

type SaveOutcome =
    | { ok: true; status: number; body: Record<string, unknown> }
    | { ok: false; failure: QuestionSaveFailure };

/**
 * 把任务结果写入错题（任务须已被本进程抢占为 saving）。成功时标记 saved 并清空图片；
 * 失败时：自动入库任务标记 failed（保留结果，可重试保存），校对任务退回 review（保留草稿）。
 */
async function saveTask(task: ImportTask, user: User, input: unknown): Promise<SaveOutcome> {
    const started = Date.now();
    const parsed = importSchema.safeParse(input);
    const result: SaveQuestionResult = parsed.success
        ? await saveQuestion(user, parsed.data, {
            // 与错题写入同一事务：任务已不在保存中（被丢弃或判为中断）时整笔回滚，不留下未关联的错题
            afterWrite: async (tx, saved) => {
                const linked = await tx.importTask.updateMany({
                    where: { id: task.id, status: 'saving' },
                    data: {
                        status: 'saved', errorItemId: saved.id, duplicate: saved.duplicate, error: null,
                        imageData: '', finishedAt: new Date(), readAt: null,
                        timings: mergeTimings(task.timings, { server: { save: Date.now() - started } }),
                    },
                });
                if (linked.count === 0) throw new Error('IMPORT_TASK_STATE_CHANGED');
            },
        })
        : {
            ok: false,
            error: {
                code: 'QUESTION_SAVE_INVALID_INPUT',
                stage: 'save',
                status: 400,
                errorCode: 'VALIDATION_ERROR',
                details: parsed.error.issues,
            },
        };
    const saveMs = Date.now() - started;
    const timings = mergeTimings(task.timings, { server: { save: saveMs } });

    if (result.ok) {
        const body = result.item as unknown as Record<string, unknown>;
        logger.info({ taskId: task.id, errorItemId: body.id, duplicate: body.duplicate === true, saveMs }, 'Import task saved');
        return { ok: true, status: result.status === 'duplicate' ? 200 : 201, body };
    }

    const error = result.error.code;
    const fallback = task.mode === 'auto' ? 'failed' : 'review';
    await serializeWrite(() => prisma.importTask.updateMany({
        where: { id: task.id, status: 'saving' },
        data: { status: fallback, error: error.slice(0, 200), finishedAt: new Date(), timings, readAt: null },
    }));
    logger.warn({ taskId: task.id, error, saveMs }, 'Import task save failed');
    return { ok: false, failure: result.error };
}

/** 自动入库：用识别结果直接保存 */
function autoSavePayload(task: ImportTask, result: ParsedQuestion) {
    return parsedQuestionToSavePayload(result, {
        subjectId: task.targetSubjectId,
        imageUrl: task.imageData,
        paperLevel: task.paperLevel,
    });
}

/** 批次中的任务结束后（含失败），批次重新显示为有新结果 */
async function touchBatch(batchId: string | null): Promise<void> {
    if (!batchId) return;
    await serializeWrite(() => prisma.importBatch.updateMany({ where: { id: batchId }, data: { readAt: null } }))
        .catch((error: unknown) => logger.warn({ batchId, error: getErrorMessage(error) }, 'Failed to mark import batch unread'));
}

/** 识别一项任务：文字任务解析题目原文，图片任务识别图片 */
function analyzeTask(task: ImportTask & { user: User }): Promise<ParsedQuestion> {
    const link = task.batchId ? `/import-batches/${task.batchId}` : `/import-tasks/${task.id}`;
    const language = task.language === 'en' ? 'en' : 'zh';
    if (task.inputText) {
        return analyzeQuestionTextForUser({ userId: task.user.id, questionText: task.inputText, language, subjectId: task.subjectId, link });
    }
    return analyzeQuestionForUser({
        email: task.user.email,
        userId: task.user.id,
        imageBase64: task.imageData,
        language,
        subjectId: task.subjectId,
        link,
    });
}

/** 任务消耗的额度类别：文字题与文字解题一致，图片与拍照识别一致 */
export function quotaKindOf(task: Pick<ImportTask, 'inputText'>): 'reanswer' | 'analyze' {
    return task.inputText ? 'reanswer' : 'analyze';
}

/** 安排批次中已创建、已登记执行的任务在后台识别 */
export function scheduleImportTask(id: string, release: () => void): void {
    schedule(id, release, () => execute(id));
}

/** 后台执行：识别（如尚无结果）→ 自动入库或等待校对 */
async function execute(id: string): Promise<void> {
    const batchId = (await prisma.importTask.findUnique({ where: { id }, select: { batchId: true } }))?.batchId ?? null;
    try {
        await executeTask(id);
    } finally {
        await touchBatch(batchId);
    }
}

async function executeTask(id: string): Promise<void> {
    const stopHeartbeat = startHeartbeat(id);
    try {
        let task = await prisma.importTask.findUnique({ where: { id }, include: { user: true } });
        if (!task) return;
        const { user } = task;

        if (task.status === 'analyzing') {
            const started = Date.now();
            let result: ParsedQuestion;
            try {
                result = await analyzeTask(task);
            } catch (error) {
                const message = getErrorMessage(error);
                logger.error({ taskId: id, error: message, analyzeMs: Date.now() - started }, 'Import task analysis failed');
                await markFailed(id, 'analyzing', mapAnalysisError(message));
                return;
            }
            const analyzeMs = Date.now() - started;
            const next: ImportTaskStatus = task.mode === 'auto' ? 'saving' : 'review';
            const timings = mergeTimings(task.timings, { server: { analyze: analyzeMs } });
            const updated = await serializeWrite(() => prisma.importTask.updateMany({
                where: { id, status: 'analyzing' },
                data: {
                    status: next,
                    result: JSON.stringify(result),
                    error: null,
                    timings,
                    heartbeatAt: new Date(),
                    ...(next === 'review' ? { finishedAt: new Date(), readAt: null } : {}),
                },
            }));
            logger.info({ taskId: id, analyzeMs, next }, 'Import task analyzed');
            // 识别期间任务被丢弃
            if (updated.count === 0 || next === 'review') return;
            task = await prisma.importTask.findUnique({ where: { id }, include: { user: true } });
            if (!task) return;
        }

        if (task.status === 'saving') {
            const result = parseResult(task.result);
            if (!result) {
                await markFailed(id, 'saving', 'AI_RESPONSE_ERROR');
                return;
            }
            await saveTask(task, user, autoSavePayload(task, result));
        }
    } finally {
        stopHeartbeat();
    }
}

type CreateResult = { response: NextResponse } | { task: ImportTaskDetail; created: boolean };

/** 创建任务并安排后台识别；同一幂等键重复提交时返回已有任务 */
export async function createImportTask(user: User, raw: unknown, measured: { receiveMs?: number } = {}): Promise<CreateResult> {
    const parsed = createImportTaskSchema.safeParse(raw);
    if (!parsed.success) return { response: validationError('IMPORT_TASK_INVALID_INPUT', parsed.error.issues) };
    const input = parsed.data;

    const existing = await prisma.importTask.findUnique({
        where: { userId_clientRequestId: { userId: user.id, clientRequestId: input.clientRequestId } },
        include: withItem,
    });
    if (existing) return { task: toDetail(existing), created: false };

    if (!await ownsNotebook(user.id, input.subjectId) || !await ownsNotebook(user.id, input.targetSubjectId)) {
        return { response: validationError('IMPORT_TASK_INVALID_NOTEBOOK') };
    }

    const mode: ImportTaskMode = input.mode === 'auto' || !user.confirmBeforeImport ? 'auto' : 'review';
    const id = randomUUID().replace(/-/g, '');
    // 先登记为本进程执行中，避免创建后、开始执行前被其他请求判为中断
    const release = register(id);
    let task: TaskWithItem;
    try {
        task = await serializeWrite(() => prisma.importTask.create({
            data: {
                id,
                userId: user.id,
                clientRequestId: input.clientRequestId,
                mode,
                status: 'analyzing',
                language: input.language,
                subjectId: input.subjectId || null,
                targetSubjectId: input.targetSubjectId || null,
                paperLevel: input.paperLevel || null,
                imageData: input.imageBase64,
                imageInfo: input.imageInfo ? JSON.stringify(input.imageInfo) : null,
                timings: JSON.stringify({
                    client: input.clientTimings ?? {},
                    server: measured.receiveMs !== undefined ? { receive: measured.receiveMs } : {},
                }),
                runnerId: bootId(),
                heartbeatAt: new Date(),
            },
            include: withItem,
        }));
    } catch (error) {
        release();
        // 并发的重复提交：返回先创建的任务
        if ((error as { code?: string }).code === 'P2002') {
            const winner = await prisma.importTask.findUnique({
                where: { userId_clientRequestId: { userId: user.id, clientRequestId: input.clientRequestId } },
                include: withItem,
            });
            if (winner) return { task: toDetail(winner), created: false };
        }
        throw error;
    }

    // 只有创建成功的请求计一次额度；超出额度时任务标记失败，可次日重试或丢弃
    const limited = await serializeWrite(() => consumeAiQuota(user, 'analyze'));
    if (limited) {
        release();
        await markFailed(id, 'analyzing', 'AI_DAILY_LIMIT_EXCEEDED');
        return { response: limited };
    }

    logger.info({ taskId: id, mode, imageInfo: input.imageInfo, clientTimings: input.clientTimings }, 'Import task created');
    schedule(id, release, () => execute(id));
    return { task: toDetail(task), created: true };
}

/** 当前用户的任务：执行中、待校对、失败的全部返回，已保存的返回最近若干条 */
export async function listImportTasks(user: Pick<User, 'id'>): Promise<ImportTaskListResponse> {
    await reconcileInterrupted(user.id);
    await pruneSaved(user.id);
    const [pending, saved] = await Promise.all([
        prisma.importTask.findMany({
            where: { userId: user.id, batchId: null, status: { not: 'saved' } },
            select: summarySelect,
            orderBy: { createdAt: 'desc' },
        }),
        prisma.importTask.findMany({
            where: { userId: user.id, batchId: null, status: 'saved' },
            select: summarySelect,
            orderBy: { finishedAt: 'desc' },
            take: MAX_LISTED_SAVED,
        }),
    ]);
    const tasks = [...pending, ...saved]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(toSummary);
    return {
        tasks,
        activeCount: tasks.filter((task) => task.status === 'analyzing' || task.status === 'saving').length,
        unreadCount: tasks.filter((task) => task.unread).length,
    };
}

/** 单个任务；image 为 true 时附带题目图片（只在校对页需要时读取一次） */
export async function getImportTask(user: Pick<User, 'id'>, id: string, options: { image?: boolean } = {}): Promise<ImportTaskDetail | null> {
    await reconcileInterrupted(user.id, id);
    const task = await prisma.importTask.findFirst({
        where: { id, userId: user.id },
        select: { ...summarySelect, paperLevel: true, imageData: options.image === true },
    });
    return task ? toDetail(task, options) : null;
}

/** 标记已查看（清除未读提示） */
export async function markImportTaskRead(user: Pick<User, 'id'>, id: string): Promise<boolean> {
    const updated = await serializeWrite(() => prisma.importTask.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } }));
    if (updated.count > 0) return true;
    return (await prisma.importTask.count({ where: { id, userId: user.id } })) > 0;
}

/** 丢弃任务；正在保存时不允许，避免已入库的结果失去记录 */
export async function discardImportTask(user: Pick<User, 'id'>, id: string): Promise<NextResponse> {
    const task = await findOwnTask(user, id);
    if (!task) return notFound('IMPORT_TASK_NOT_FOUND');
    const deleted = await serializeWrite(() => prisma.importTask.deleteMany({ where: { id, userId: user.id, status: { not: 'saving' } } }));
    if (deleted.count === 0) return createErrorResponse('IMPORT_TASK_BUSY', 409, ErrorCode.CONFLICT);
    return NextResponse.json({ success: true });
}

function busyOrDone(task: TaskWithItem): NextResponse {
    if (task.status === 'saved' && task.errorItemId) {
        // 重复确认：返回已入库的结果，不再保存
        return NextResponse.json({ id: task.errorItemId, duplicate: task.duplicate, alreadySaved: true, importTask: toSummary(task) });
    }
    return createErrorResponse(task.status === 'saving' ? 'IMPORT_TASK_BUSY' : 'IMPORT_TASK_NOT_REVIEWABLE', 409, ErrorCode.CONFLICT, { status: task.status });
}

/** 校对后确认入库；同一任务只会入库一次 */
export async function confirmImportTask(user: User, id: string, raw: unknown): Promise<NextResponse> {
    const task = await findOwnTask(user, id);
    if (!task) return notFound('IMPORT_TASK_NOT_FOUND');
    if (task.status !== 'review') return busyOrDone(task);

    const parsed = confirmSchema.safeParse(raw);
    if (!parsed.success) return validationError('QUESTION_SAVE_INVALID_INPUT', parsed.error.issues);
    // 固定错题本的任务（从错题本的添加页发起）不允许改放到其他错题本
    const subjectId = task.targetSubjectId ?? parsed.data.subjectId ?? null;
    if (!await ownsNotebook(user.id, subjectId)) return validationError('IMPORT_TASK_INVALID_NOTEBOOK');

    const release = register(id);
    const claimed = await serializeWrite(() => prisma.importTask.updateMany({
        where: { id, userId: user.id, status: 'review' },
        data: { status: 'saving', runnerId: bootId(), heartbeatAt: new Date(), error: null },
    }));
    if (claimed.count === 0) {
        release();
        const current = await prisma.importTask.findFirst({ where: { id, userId: user.id }, include: withItem });
        return current ? busyOrDone(current) : notFound('IMPORT_TASK_NOT_FOUND');
    }
    try {
        const outcome = await saveTask(task, user, { ...parsed.data, subjectId, originalImageUrl: task.imageData });
        if (!outcome.ok) return questionSaveFailureToResponse(outcome.failure);
        const saved = await prisma.importTask.findUniqueOrThrow({ where: { id }, include: withItem });
        return NextResponse.json({ ...outcome.body, importTask: toSummary(saved) }, { status: outcome.status });
    } catch (error) {
        // 保存过程中出现意外错误：退回待校对，草稿不丢失
        await serializeWrite(() => prisma.importTask.updateMany({ where: { id, status: 'saving' }, data: { status: 'review', error: 'QUESTION_SAVE_FAILED' } }));
        throw error;
    } finally {
        release();
    }
}

/**
 * 重试失败的任务：已有识别结果时不重新调用 AI——自动入库任务重试保存，校对任务回到待校对；
 * 识别本身失败时重新识别（消耗一次额度）。
 */
export async function retryImportTask(user: User, id: string): Promise<NextResponse> {
    const task = await findOwnTask(user, id);
    if (!task) return notFound('IMPORT_TASK_NOT_FOUND');
    if (task.status !== 'failed') {
        // 重复的重试请求（另一个重试已抢占、正在执行）：与抢占失败的并发请求一样返回当前任务，结果不依赖请求先后
        if ((task.status === 'analyzing' || task.status === 'saving') && task.attempts > 1) {
            return NextResponse.json({ task: toDetail(task) });
        }
        return createErrorResponse('IMPORT_TASK_NOT_RETRYABLE', 409, ErrorCode.CONFLICT, { status: task.status });
    }
    const hasResult = parseResult(task.result) !== null;
    if (!hasResult && !task.imageData && !task.inputText) return createErrorResponse('IMPORT_TASK_NOT_RETRYABLE', 409, ErrorCode.CONFLICT);

    if (hasResult && task.mode === 'review') {
        await serializeWrite(() => prisma.importTask.updateMany({
            where: { id, status: 'failed' },
            data: { status: 'review', error: null, attempts: { increment: 1 }, finishedAt: new Date() },
        }));
    } else {
        const release = register(id);
        const claimed = await serializeWrite(() => prisma.importTask.updateMany({
            where: { id, status: 'failed' },
            data: {
                status: hasResult ? 'saving' : 'analyzing',
                error: null,
                attempts: { increment: 1 },
                runnerId: bootId(),
                heartbeatAt: new Date(),
                finishedAt: null,
            },
        }));
        if (claimed.count === 0) {
            release();
            const current = await prisma.importTask.findFirstOrThrow({ where: { id }, include: withItem });
            return NextResponse.json({ task: toDetail(current) });
        }
        // 抢占成功后才计额度，并发重试只计一次；只重试保存时不调用 AI，不计额度
        if (!hasResult) {
            const limited = await serializeWrite(() => consumeAiQuota(user, quotaKindOf(task)));
            if (limited) {
                release();
                await markFailed(id, 'analyzing', 'AI_DAILY_LIMIT_EXCEEDED');
                return limited;
            }
        }
        schedule(id, release, () => execute(id));
    }
    logger.info({ taskId: id, reanalyze: !hasResult }, 'Import task retried');
    const current = await prisma.importTask.findFirstOrThrow({ where: { id }, include: withItem });
    return NextResponse.json({ task: toDetail(current) }, { status: 202 });
}

/** 仅供测试：等待后台执行结束 */
export async function waitForImportTaskForTest(id: string): Promise<void> {
    await inflight.get(id);
}

/** 仅供测试：模拟服务重启（清空本进程的执行登记并更换启动编号） */
export function simulateRestartForTest(): void {
    running.clear();
    inflight.clear();
    runtime.__importTaskBootId = randomUUID();
}

/** 仅供测试 */
export function currentBootIdForTest(): string {
    return bootId();
}
