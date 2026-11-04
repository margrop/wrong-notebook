/**
 * 识别导入任务的前后端共用类型与常量（不依赖数据库，可在浏览器中引用）
 */
import type { ParsedQuestion } from "@/lib/ai";
import type { ImportBatchSummary } from "@/lib/import/import-batch-types";

export const IMPORT_TASK_STATUSES = ['analyzing', 'review', 'saving', 'saved', 'failed'] as const;
export type ImportTaskStatus = typeof IMPORT_TASK_STATUSES[number];
export type ImportTaskMode = 'review' | 'auto';

/** 仍在服务端执行的状态 */
export const ACTIVE_IMPORT_TASK_STATUSES: readonly ImportTaskStatus[] = ['analyzing', 'saving'];
/** 需要用户查看的结束状态，未读时显示提示 */
export const FINISHED_IMPORT_TASK_STATUSES: readonly ImportTaskStatus[] = ['review', 'saved', 'failed'];

/** 浏览器端各阶段耗时（毫秒） */
export const CLIENT_TIMING_KEYS = ['read', 'convert', 'crop', 'compress', 'upload'] as const;
export type ClientTimingKey = typeof CLIENT_TIMING_KEYS[number];
/** 服务端各阶段耗时（毫秒） */
/** receive 为服务端接收上传内容的用时，可近似反映上传速度 */
export const SERVER_TIMING_KEYS = ['receive', 'analyze', 'save'] as const;
export type ServerTimingKey = typeof SERVER_TIMING_KEYS[number];

export interface ImportTaskTimings {
    client?: Partial<Record<ClientTimingKey, number>>;
    server?: Partial<Record<ServerTimingKey, number>>;
}

/** 上传图片的格式、像素与体积，不含图片内容 */
export interface ImportImageInfo {
    sourceType?: string;
    sourceBytes?: number;
    sourceWidth?: number;
    sourceHeight?: number;
    outputWidth?: number;
    outputHeight?: number;
    outputBytes?: number;
    /** 解码方式：native 系统解码，heic 按需加载的 HEIC 解码库 */
    decoder?: 'native' | 'heic';
    quality?: number;
}

/** 任务列表中的摘要（不含图片与完整识别结果） */
export interface ImportTaskSummary {
    id: string;
    status: ImportTaskStatus;
    mode: ImportTaskMode;
    subjectId: string | null;
    targetSubjectId: string | null;
    /** 题干开头，识别完成后才有 */
    excerpt: string | null;
    /** 所属多题批次；单独上传的任务为空 */
    batchId: string | null;
    batchItemKey: string | null;
    error: string | null;
    errorItemId: string | null;
    errorItemShortId: string | null;
    notebookName: string | null;
    duplicate: boolean;
    hasResult: boolean;
    unread: boolean;
    attempts: number;
    timings: ImportTaskTimings;
    createdAt: string;
    finishedAt: string | null;
}

/** 单个任务详情：含待校对的识别结果；题目图片只在请求时（校对页）返回，其余为 null */
export interface ImportTaskDetail extends ImportTaskSummary {
    result: ParsedQuestion | null;
    imageData: string | null;
    paperLevel: string | null;
}

export interface ImportTaskListResponse {
    tasks: ImportTaskSummary[];
    /** 多题批次（批次内的任务不在 tasks 中单独列出）；旧接口没有时视为空 */
    batches?: ImportBatchSummary[];
    activeCount: number;
    unreadCount: number;
}

/** 已保存的任务保留天数；待校对和失败的任务不会自动删除，需用户处理或丢弃 */
export const SAVED_IMPORT_TASK_RETENTION_DAYS = 7;

/** 服务重启（或执行中断）导致任务未完成时记录的错误码 */
export const IMPORT_TASK_INTERRUPTED_ERROR = 'SERVER_RESTARTED';
