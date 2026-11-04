/**
 * 导入步骤：未完成的多题批次、未处理的识别导入任务与 fork 扩展数据。
 */
import { importImportBatches, importImportTasks } from "@/lib/import/import-task-backup";
import { importExtensions } from "@/lib/backup-extensions";
import type { ImportContext } from "./types";

/**
 * 8. 导入未完成的多题批次与未处理的识别导入任务：只还原草稿和失败记录，不会自动重新调用 AI。
 */
export async function importBatchesAndTasks(ctx: ImportContext): Promise<void> {
    const { tx, user, importAll, normalized, stats, subjectIdMap, paperGroupIdMap, errorItemIdMap } = ctx;
    const backupContext = {
        resolveUserId: (raw: string) => importAll ? raw : user.id,
        subjectIdMap,
        paperGroupIdMap,
        errorItemIdMap,
    };
    const batches = await importImportBatches(tx, normalized.data.importBatches, backupContext);
    stats.importBatchesCreated = batches.created;
    stats.importTasksCreated = await importImportTasks(tx, normalized.data.importTasks, { ...backupContext, batchIdMap: batches.idMap });
}

/** 10. 导入 fork 注册的扩展数据；未注册 key 或版本过新都安全跳过，扩展抛错回滚整个事务 */
export async function importRegisteredExtensions(ctx: ImportContext): Promise<void> {
    const { tx, user, importAll, normalized, stats, subjectIdMap, errorItemIdMap, tagIdMap, examPaperIdMap, examQuestionIdMap } = ctx;
    stats.extensionsImported = await importExtensions({
        tx,
        userIdMap: (oldUserId) => (importAll ? oldUserId : user.id),
        subjectIdMap,
        errorItemIdMap,
        tagIdMap,
        examPaperIdMap,
        examQuestionIdMap,
    }, normalized.data.extensions);
}
