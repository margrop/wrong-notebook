/**
 * 备份导入的写库侧入口：在事务内按 import-parser 规范化后的数据完成全部写入与 ID 映射，
 * 返回导入统计。按实体拆分为各步骤函数，此处只负责创建上下文并按顺序调用。
 */
import { scheduleMasteryEvaluation } from "@/lib/mastery";
import { createImportContext } from "./types";
import type { ImportWriterOptions, ImportWriterResult } from "./types";
import { importPreferences, importSubjects } from "./subjects";
import { importSystemTags, importCustomTags, preloadErrorItemTags } from "./tags";
import { importPaperGroups, importErrorItems } from "./error-items";
import { importReviewSchedules, importExamPapers } from "./exams";
import { importPracticeRecords, syncMasteryThreshold } from "./practice";
import { importBatchesAndTasks, importRegisteredExtensions } from "./misc";

export { createImportContext } from "./types";
export type { ImportStats, ImportContext, ImportWriterOptions, ImportWriterResult } from "./types";

/** 在事务内完成全部写库；调用方负责事务包裹与提交 */
export async function importBackupData(options: ImportWriterOptions): Promise<ImportWriterResult> {
    const ctx = createImportContext(options);

    // 0-1. 偏好设置与学科（错题本）
    await importPreferences(ctx);
    await importSubjects(ctx);
    // 2-4. 系统标签、自定义标签与错题标签预加载
    await importSystemTags(ctx);
    await importCustomTags(ctx);
    await preloadErrorItemTags(ctx);
    // 4. 卷别分组与错题
    await importPaperGroups(ctx);
    await importErrorItems(ctx);
    // 5-6. 复习计划与试卷
    await importReviewSchedules(ctx);
    await importExamPapers(ctx);
    // 7、9. 练习记录与掌握阈值同步
    await importPracticeRecords(ctx);
    await syncMasteryThreshold(ctx);
    // 8、10. 导入批次/任务与扩展数据
    await importBatchesAndTasks(ctx);
    await importRegisteredExtensions(ctx);

    return { stats: ctx.stats, masteryIds: [...ctx.masteryIds] };
}

/** 事务提交后调度掌握概率重新评估（原 route 行为保持一致） */
export function scheduleImportMasteryEvaluation(masteryIds: string[]): void {
    if (masteryIds.length) scheduleMasteryEvaluation(masteryIds);
}
