/**
 * 多题批次的前端接口封装
 */
import { apiClient } from "@/lib/api-client";
import type { ImportBatchDetail } from "@/lib/import/import-batch-types";
import { newClientRequestId, notifyImportTasksChanged } from "@/lib/import/import-task-client";
import type { ImportImageInfo } from "@/lib/import/import-task-types";
import type { BatchDraft } from "@/lib/question-split/draft";
import type { TextFixSuggestion } from "@/lib/question-split/draft-ops";

export interface CreateImportBatchInput {
    source: "text" | "image";
    splitter?: "local" | "ai";
    /** 编号像小问时仍按编号分题 */
    forceNumbered?: boolean;
    text?: string;
    imageBase64?: string;
    imageInfo?: ImportImageInfo;
    language: "zh" | "en";
    subjectId?: string | null;
    targetSubjectId?: string | null;
    paperLevel?: string | null;
}

/** 上传失败时的重试次数（同一幂等键） */
const CREATE_ATTEMPTS = 3;
const UPLOAD_TIMEOUT_MS = 120_000;

function isRetryable(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    return status === undefined || status === 408 || status === 502 || status === 503 || status === 504;
}

/** 网络中断或网关超时时用同一请求重试（服务端按幂等键或状态去重） */
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
        try {
            return await run();
        } catch (error) {
            lastError = error;
            if (!isRetryable(error) || attempt === CREATE_ATTEMPTS - 1) break;
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
    throw lastError;
}

export async function createImportBatch(input: CreateImportBatchInput, clientRequestId = newClientRequestId()): Promise<ImportBatchDetail> {
    const { batch } = await withRetry(() => apiClient.post<{ batch: ImportBatchDetail }>("/api/import-batches", {
        ...input,
        clientRequestId,
        subjectId: input.subjectId || undefined,
        targetSubjectId: input.targetSubjectId || undefined,
        paperLevel: input.paperLevel || undefined,
    }, { timeout: UPLOAD_TIMEOUT_MS }));
    notifyImportTasksChanged();
    return batch;
}

export async function fetchImportBatch(id: string, options: { image?: boolean } = {}): Promise<ImportBatchDetail> {
    const query = options.image ? "?include=image" : "";
    const { batch } = await apiClient.get<{ batch: ImportBatchDetail }>(`/api/import-batches/${encodeURIComponent(id)}${query}`);
    return batch;
}

export async function saveImportBatchDraft(id: string, version: number, draft: BatchDraft): Promise<ImportBatchDetail> {
    const { batch } = await apiClient.patch<{ batch: ImportBatchDetail }>(`/api/import-batches/${encodeURIComponent(id)}`, { version, draft });
    return batch;
}

export interface BatchItemImage {
    key: string;
    imageBase64: string;
    imageInfo?: ImportImageInfo;
}

export async function startImportBatch(id: string, version: number, images?: BatchItemImage[]): Promise<ImportBatchDetail> {
    const { batch } = await withRetry(() => apiClient.post<{ batch: ImportBatchDetail }>(
        `/api/import-batches/${encodeURIComponent(id)}/start`, { version, images }, { timeout: UPLOAD_TIMEOUT_MS }));
    notifyImportTasksChanged();
    return batch;
}

export async function retryImportBatch(id: string): Promise<ImportBatchDetail> {
    const { batch } = await apiClient.post<{ batch: ImportBatchDetail }>(`/api/import-batches/${encodeURIComponent(id)}/retry`, {});
    notifyImportTasksChanged();
    return batch;
}

export async function confirmAllImportBatch(id: string): Promise<{ batch: ImportBatchDetail; saved: number; failed: number }> {
    const result = await apiClient.post<{ batch: ImportBatchDetail; saved: number; failed: number }>(`/api/import-batches/${encodeURIComponent(id)}/confirm-all`, {});
    notifyImportTasksChanged();
    return result;
}

export async function discardImportBatch(id: string): Promise<void> {
    await apiClient.delete(`/api/import-batches/${encodeURIComponent(id)}`);
    notifyImportTasksChanged();
}

export async function markImportBatchRead(id: string): Promise<void> {
    await apiClient.post(`/api/import-batches/${encodeURIComponent(id)}/read`, {});
    notifyImportTasksChanged();
}

/** 保存冲突时服务端返回的最新批次 */
export function conflictBatch(error: unknown): ImportBatchDetail | null {
    const data = (error as { status?: number; data?: { details?: { batch?: ImportBatchDetail } } });
    return data?.status === 409 ? data.data?.details?.batch ?? null : null;
}

export interface ImportBatchTextFixResult {
    fixes: TextFixSuggestion[];
    unchanged: string[];
    failed: string[];
}

/** 修正多题时耗时较长：超时放宽，连接中断后可取回响应 */
const TEXT_FIX_TIMEOUT_MS = 10 * 60 * 1000;

/** 为若干题生成「AI 修正文字」建议（不改动服务端草稿） */
export async function fixImportBatchText(id: string, items: Array<{ key: string; text: string }>): Promise<ImportBatchTextFixResult> {
    return apiClient.post<ImportBatchTextFixResult>(`/api/import-batches/${encodeURIComponent(id)}/fix-text`, { items }, { timeout: TEXT_FIX_TIMEOUT_MS, recoverable: true });
}
