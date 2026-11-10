/**
 * 导入步骤：fork 扩展数据。
 */
import { importExtensions } from "@/lib/backup-extensions";
import type { ImportContext } from "./types";

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
