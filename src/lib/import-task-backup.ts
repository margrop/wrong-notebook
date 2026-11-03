/**
 * 备份导入：还原未处理的识别导入任务（待校对草稿与失败可重试的任务）。
 * 只写入记录，不会安排后台执行；导出时仍在执行的任务按中断处理，需用户在任务列表中重试。
 *
 * 以任务的幂等键（clientRequestId，旧数据没有时用原任务编号）作为来源标识，写入新任务的同一字段：
 * 同一账户内按「用户 + 来源标识」判断是否已导入，跨账户恢复、重复导入或再次导出后导入都不会重复创建；
 * 同一时间、同一图片的不同任务来源标识不同，全部还原。新任务使用新编号，不复用、不覆盖其他账户的任务。
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ParsedQuestionSchema } from "@/lib/ai/schema";
import { IMPORT_TASK_INTERRUPTED_ERROR } from "@/lib/import-task-types";

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
        // 既没有识别结果也没有图片的任务无法继续处理
        if (!result && !imageData) continue;

        const createdAt = parseDate(task.createdAt);
        const sourceKey = task.clientRequestId || task.id;
        if (sourceKey) {
            const imported = await tx.importTask.count({ where: { userId, OR: [{ clientRequestId: sourceKey }, { id: sourceKey }] } });
            if (imported > 0) continue;
        }

        const mapId = (id: string | null | undefined, map: Map<string, string>) => (id && map.has(id) ? map.get(id)! : null);
        const mode = task.mode === 'auto' ? 'auto' : 'review';
        // 只有带有效草稿的待校对任务保持待校对；其余（含导出时仍在执行的）一律为失败，需用户手动重试
        const status = task.status === 'review' && result ? 'review' : 'failed';
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
                createdAt,
                finishedAt: parseDate(task.finishedAt) ?? new Date(),
            },
        });
        created++;
    }
    return created;
}
