/**
 * 备份导入：还原未完成的多题批次（version 6 起）与未处理的识别导入任务（待校对草稿与失败可重试的任务）。
 * 只写入记录，不会安排后台执行；导出时仍在执行的任务按中断处理，需用户在任务列表中重试。
 *
 * 以任务的幂等键（clientRequestId，旧数据没有时用原任务编号）作为来源标识，写入新任务的同一字段：
 * 同一账户内按「用户 + 来源标识」判断是否已导入，跨账户恢复、重复导入或再次导出后导入都不会重复创建；
 * 同一时间、同一图片的不同任务来源标识不同，全部还原。新任务使用新编号，不复用、不覆盖其他账户的任务。
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ParsedQuestionSchema } from "@/lib/ai/schema";
import { IMPORT_TASK_INTERRUPTED_ERROR } from "@/lib/import/import-task-types";
import { batchDraftSchema } from "@/lib/question-split/draft";
import { MAX_SPLIT_TEXT_LENGTH } from "@/lib/question-split/text";

const IMAGE_DATA_PATTERN = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const backupTaskSchema = z.object({
    id: z.string().regex(TASK_ID_PATTERN).optional(),
    clientRequestId: z.string().regex(TASK_ID_PATTERN).nullish(),
    userId: z.string().max(100).optional(),
    mode: z.string().optional(),
    status: z.string().optional(),
    language: z.string().optional(),
    subjectId: z.string().max(100).nullish(),
    targetSubjectId: z.string().max(100).nullish(),
    paperLevel: z.string().max(100).nullish(),
    imageData: z.string().max(15 * 1024 * 1024).nullish(),
    imageInfo: z.string().max(10_000).nullish(),
    result: z.string().max(500_000).nullish(),
    error: z.string().max(200).nullish(),
    timings: z.string().max(10_000).nullish(),
    attempts: z.number().int().min(1).max(1000).optional(),
    createdAt: z.string().optional(),
    finishedAt: z.string().nullish(),
    // version 6 起：所属多题批次与文字任务的题目原文
    batchId: z.string().max(100).nullish(),
    batchItemKey: z.string().max(40).nullish(),
    inputText: z.string().max(40_000).nullish(),
    // version 6 起：批次中已保存的题所关联的错题与是否判为重复
    errorItemId: z.string().max(100).nullish(),
    duplicate: z.boolean().optional(),
});

const backupBatchSchema = z.object({
    id: z.string().regex(TASK_ID_PATTERN),
    clientRequestId: z.string().regex(TASK_ID_PATTERN).nullish(),
    userId: z.string().max(100).optional(),
    source: z.enum(['text', 'image']),
    splitter: z.enum(['local', 'ai']).optional(),
    status: z.string().optional(),
    mode: z.string().nullish(),
    language: z.string().optional(),
    subjectId: z.string().max(100).nullish(),
    targetSubjectId: z.string().max(100).nullish(),
    paperLevel: z.string().max(100).nullish(),
    sourceText: z.string().max(MAX_SPLIT_TEXT_LENGTH).nullish(),
    imageData: z.string().max(15 * 1024 * 1024).nullish(),
    imageInfo: z.string().max(10_000).nullish(),
    draft: z.string().max(2_000_000).nullish(),
    error: z.string().max(200).nullish(),
    attempts: z.number().int().min(1).max(1000).optional(),
    createdAt: z.string().optional(),
    startedAt: z.string().nullish(),
    finishedAt: z.string().nullish(),
});

function parseDate(value: string | null | undefined): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function validResult(raw: string | null | undefined): string | null {
    if (!raw) return null;
    try {
        const parsed = ParsedQuestionSchema.safeParse(JSON.parse(raw));
        return parsed.success ? JSON.stringify(parsed.data) : null;
    } catch {
        return null;
    }
}

interface ImportTaskBackupContext {
    /** 导出文件中的用户编号 → 写入的用户编号（非管理员导入时均为当前用户） */
    resolveUserId: (raw: string) => string;
    subjectIdMap: Map<string, string>;
    paperGroupIdMap: Map<string, string>;
    /** 导出文件中的批次编号 → 写入的批次编号；任务的批次不在其中时按单独任务还原 */
    batchIdMap?: Map<string, string>;
    /** 导出文件中的错题编号 → 写入（或已存在）的错题编号，用于还原批次中已保存的题的链接 */
    errorItemIdMap?: Map<string, string>;
}

function validDraft(raw: string | null | undefined): string | null {
    if (!raw) return null;
    try {
        const parsed = batchDraftSchema.safeParse(JSON.parse(raw));
        return parsed.success ? JSON.stringify(parsed.data) : null;
    } catch {
        return null;
    }
}

const mapId = (id: string | null | undefined, map: Map<string, string>) => (id && map.has(id) ? map.get(id)! : null);

/**
 * 还原未完成的多题批次：草稿保持待确认，分题中的一律按中断失败处理（需用户手动重新分题），已开始的保持已开始。
 * 返回新建数与「导出编号 → 写入编号」（已导入过的批次映射到已有批次，任务仍能关联）。
 */
export async function importImportBatches(tx: Prisma.TransactionClient, raw: unknown, context: ImportTaskBackupContext): Promise<{ created: number; idMap: Map<string, string> }> {
    const idMap = new Map<string, string>();
    if (!Array.isArray(raw)) return { created: 0, idMap };
    let created = 0;
    for (const entry of raw) {
        const parsed = backupBatchSchema.safeParse(entry);
        if (!parsed.success) continue;
        const batch = parsed.data;
        const userId = context.resolveUserId(batch.userId ?? '');
        if ((await tx.user.count({ where: { id: userId } })) === 0) continue;
        const sourceKey = batch.clientRequestId || batch.id;
        const existing = await tx.importBatch.findFirst({ where: { userId, OR: [{ clientRequestId: sourceKey }, { id: sourceKey }] }, select: { id: true } });
        if (existing) {
            idMap.set(batch.id, existing.id);
            continue;
        }
        const imageData = batch.imageData && IMAGE_DATA_PATTERN.test(batch.imageData) ? batch.imageData : '';
        const draft = validDraft(batch.draft);
        // 分题需要的原文或图片都没有，且没有草稿时无法继续
        if (!draft && !imageData && !batch.sourceText) continue;
        const status = batch.status === 'started' ? 'started' : batch.status === 'draft' && draft ? 'draft' : 'failed';
        const error = status === 'failed'
            ? (batch.status === 'splitting' || batch.status === 'draft' ? IMPORT_TASK_INTERRUPTED_ERROR : batch.error || IMPORT_TASK_INTERRUPTED_ERROR)
            : null;
        const createdBatch = await tx.importBatch.create({
            data: {
                userId,
                clientRequestId: sourceKey,
                source: batch.source,
                splitter: batch.splitter ?? (batch.source === 'image' ? 'ai' : 'local'),
                status,
                mode: batch.mode === 'auto' || batch.mode === 'review' ? batch.mode : null,
                language: batch.language === 'en' ? 'en' : 'zh',
                subjectId: mapId(batch.subjectId, context.subjectIdMap),
                targetSubjectId: mapId(batch.targetSubjectId, context.subjectIdMap),
                paperLevel: mapId(batch.paperLevel, context.paperGroupIdMap),
                sourceText: batch.sourceText ?? null,
                imageData,
                imageInfo: batch.imageInfo ?? null,
                draft,
                error,
                attempts: batch.attempts ?? 1,
                createdAt: parseDate(batch.createdAt),
                startedAt: parseDate(batch.startedAt) ?? null,
                finishedAt: parseDate(batch.finishedAt) ?? new Date(),
            },
            select: { id: true },
        });
        idMap.set(batch.id, createdBatch.id);
        created++;
    }
    return { created, idMap };
}

/** 返回新建的任务数；同一账户已导入过同一来源任务时跳过 */
export async function importImportTasks(tx: Prisma.TransactionClient, raw: unknown, context: ImportTaskBackupContext): Promise<number> {
    if (!Array.isArray(raw)) return 0;
    let created = 0;
    const knownUsers = new Map<string, boolean>();
    for (const entry of raw) {
        const parsed = backupTaskSchema.safeParse(entry);
        if (!parsed.success) continue;
        const task = parsed.data;
        const userId = context.resolveUserId(task.userId ?? '');
        if (!knownUsers.has(userId)) knownUsers.set(userId, (await tx.user.count({ where: { id: userId } })) > 0);
        if (!knownUsers.get(userId)) continue;

        const imageData = task.imageData && IMAGE_DATA_PATTERN.test(task.imageData) ? task.imageData : '';
        const result = validResult(task.result);
        const inputText = task.inputText?.trim() ? task.inputText : null;
        const batchId = task.batchId && context.batchIdMap?.has(task.batchId) ? context.batchIdMap.get(task.batchId)! : null;
        // 批次中已保存的题按完成记录还原：保持已保存、关联到还原后的错题，不重新识别也不重复记做错记录
        const savedInBatch = task.status === 'saved' && batchId !== null;
        if (task.status === 'saved' && !savedInBatch) continue;
        // 既没有识别结果、也没有图片或题目原文的未完成任务无法继续处理
        if (!savedInBatch && !result && !imageData && !inputText) continue;

        const createdAt = parseDate(task.createdAt);
        const sourceKey = task.clientRequestId || task.id;
        if (sourceKey) {
            const imported = await tx.importTask.count({ where: { userId, OR: [{ clientRequestId: sourceKey }, { id: sourceKey }] } });
            if (imported > 0) continue;
        }

        const mode = task.mode === 'auto' ? 'auto' : 'review';
        // 只有带有效草稿的待校对任务保持待校对；其余（含导出时仍在执行的）一律为失败，需用户手动重试
        const status = savedInBatch ? 'saved' : task.status === 'review' && result ? 'review' : 'failed';
        // 关联的错题已被删除（或不在备份中）时为空，界面显示「已保存，但该错题之后已被删除」
        const errorItemId = savedInBatch && task.errorItemId ? context.errorItemIdMap?.get(task.errorItemId) ?? null : null;
        const error = status === 'failed'
            ? (task.status === 'analyzing' || task.status === 'saving' ? IMPORT_TASK_INTERRUPTED_ERROR : task.error || IMPORT_TASK_INTERRUPTED_ERROR)
            : null;

        await tx.importTask.create({
            data: {
                userId,
                clientRequestId: sourceKey ?? null,
                mode,
                status,
                language: task.language === 'en' ? 'en' : 'zh',
                subjectId: mapId(task.subjectId, context.subjectIdMap),
                targetSubjectId: mapId(task.targetSubjectId, context.subjectIdMap),
                paperLevel: mapId(task.paperLevel, context.paperGroupIdMap),
                imageData,
                imageInfo: task.imageInfo ?? null,
                result,
                error,
                timings: task.timings ?? null,
                attempts: task.attempts ?? 1,
                inputText,
                batchId,
                batchItemKey: batchId ? task.batchItemKey ?? null : null,
                errorItemId,
                duplicate: savedInBatch ? task.duplicate === true : false,
                ...(savedInBatch ? { readAt: new Date() } : {}),
                createdAt,
                finishedAt: parseDate(task.finishedAt) ?? new Date(),
            },
        });
        created++;
    }
    return created;
}
