/**
 * 识别任务列表的状态筛选（纯函数）：任务按状态匹配，多题批次按阶段与各题汇总匹配。
 * 批次作为一张卡片显示，命中任一符合条件的题即计入对应筛选，不把批次拆成零散任务。
 */
import type { ImportBatchSummary } from "./import-batch-types";
import type { ImportTaskListResponse, ImportTaskSummary } from "./import-task-types";

export const IMPORT_TASK_FILTERS = ["all", "active", "review", "saved", "failed"] as const;
export type ImportTaskFilter = (typeof IMPORT_TASK_FILTERS)[number];

/** 任务状态是否属于所选筛选 */
export function matchesImportTaskFilter(task: ImportTaskSummary, filter: ImportTaskFilter): boolean {
    switch (filter) {
        case "all":
            return true;
        case "active":
            return task.status === "analyzing" || task.status === "saving";
        case "review":
            return task.status === "review";
        case "saved":
            return task.status === "saved";
        case "failed":
            return task.status === "failed";
    }
}

/** 批次阶段与各题汇总是否属于所选筛选；待确认分题的草稿也算待校对 */
export function matchesImportBatchFilter(batch: ImportBatchSummary, filter: ImportTaskFilter): boolean {
    switch (filter) {
        case "all":
            return true;
        case "active":
            return batch.phase === "splitting" || batch.phase === "processing";
        case "review":
            return batch.phase === "draft" || batch.counts.review > 0;
        case "saved":
            return batch.phase === "done";
        case "failed":
            return batch.phase === "failed" || batch.counts.failed > 0;
    }
}

export interface FilteredImportCenter {
    tasks: ImportTaskSummary[];
    batches: ImportBatchSummary[];
    /** 各筛选项命中的条目数（任务卡片 + 批次卡片） */
    counts: Record<ImportTaskFilter, number>;
}

/** 按筛选返回任务与批次，并统计每个筛选项的条目数 */
export function filterImportCenter(data: ImportTaskListResponse, filter: ImportTaskFilter): FilteredImportCenter {
    const tasks = data.tasks.filter((task) => matchesImportTaskFilter(task, filter));
    const batches = (data.batches ?? []).filter((batch) => matchesImportBatchFilter(batch, filter));
    const counts = Object.fromEntries(IMPORT_TASK_FILTERS.map((value) => [
        value,
        data.tasks.filter((task) => matchesImportTaskFilter(task, value)).length
        + (data.batches ?? []).filter((batch) => matchesImportBatchFilter(batch, value)).length,
    ])) as Record<ImportTaskFilter, number>;
    return { tasks, batches, counts };
}
