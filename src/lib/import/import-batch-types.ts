/**
 * 多题录入批次的前后端共用类型（不依赖数据库，可在浏览器中引用）
 */
import type { BatchDraft } from "@/lib/question-split/draft";
import type { ImportTaskMode, ImportTaskSummary } from "@/lib/import/import-task-types";

/** 开始解析时一次提交的全部裁片（data URL）的总长度上限，前后端一致 */
export const MAX_START_IMAGES_LENGTH = 60 * 1024 * 1024;

export type ImportBatchSource = "text" | "image";
export type ImportBatchSplitter = "local" | "ai";
/** splitting 分题中 | draft 待确认 | started 已开始解析 | failed 分题失败 */
export type ImportBatchStatus = "splitting" | "draft" | "started" | "failed";
/** 面向用户的阶段：由批次状态和各题任务汇总得出 */
export type ImportBatchPhase = "splitting" | "failed" | "draft" | "processing" | "attention" | "done";

/** 各题任务的数量汇总 */
export interface ImportBatchCounts {
    /** 已开始解析的题数 */
    total: number;
    /** 解析或保存中 */
    active: number;
    /** 待校对 */
    review: number;
    /** 已入库（含判为重复、已记入原题做错记录的） */
    saved: number;
    duplicate: number;
    failed: number;
}

export interface ImportBatchSummary {
    id: string;
    source: ImportBatchSource;
    splitter: ImportBatchSplitter;
    status: ImportBatchStatus;
    phase: ImportBatchPhase;
    mode: ImportTaskMode | null;
    /** 草稿中的题数与已选题数 */
    itemCount: number;
    selectedCount: number;
    counts: ImportBatchCounts;
    /** 第一题的开头，用于在列表中辨认 */
    excerpt: string | null;
    error: string | null;
    unread: boolean;
    attempts: number;
    createdAt: string;
    startedAt: string | null;
}

export interface ImportBatchDetail extends ImportBatchSummary {
    version: number;
    draft: BatchDraft | null;
    /** 已开始后各题对应的识别任务（按草稿顺序） */
    tasks: ImportTaskSummary[];
    /** 整页图片：只在请求时返回 */
    imageData: string | null;
    subjectId: string | null;
    targetSubjectId: string | null;
    paperLevel: string | null;
}

/** 汇总阶段：分题中/失败/待确认；开始后按任务状态区分处理中、需要处理（待校对或失败）、全部完成 */
export function batchPhase(status: ImportBatchStatus, counts: ImportBatchCounts): ImportBatchPhase {
    if (status !== "started") return status;
    if (counts.active > 0) return "processing";
    if (counts.review > 0 || counts.failed > 0) return "attention";
    return "done";
}
