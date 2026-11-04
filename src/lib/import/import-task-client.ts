/**
 * 识别导入任务的前端接口封装
 */
import { apiClient } from "@/lib/api-client";
import type {
    ClientTimingKey, ImportImageInfo, ImportTaskDetail, ImportTaskListResponse, ImportTaskSummary,
} from "@/lib/import/import-task-types";

/** 任务列表变化（新建、确认、重试、丢弃）时广播，入口与列表页立即刷新 */
export const IMPORT_TASKS_CHANGED_EVENT = "wrong-notebook:import-tasks-changed";

export function notifyImportTasksChanged(): void {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(IMPORT_TASKS_CHANGED_EVENT));
}

/** 上传请求的幂等键：网络中断后用同一编号重新提交，不会创建第二个任务 */
export function newClientRequestId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface CreateImportTaskInput {
    imageBase64: string;
    language: "zh" | "en";
    subjectId?: string | null;
    targetSubjectId?: string | null;
    paperLevel?: string | null;
    /** 批量框选始终直接入库 */
    mode?: "auto";
    imageInfo?: ImportImageInfo;
    clientTimings?: Partial<Record<ClientTimingKey, number>>;
}

/** 上传失败时的重试次数（同一幂等键） */
const UPLOAD_ATTEMPTS = 3;
/** 上传请求超时 */
const UPLOAD_TIMEOUT_MS = 120_000;

function isRetryableUploadError(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    // 网络中断（无状态码）或网关超时可以安全重试：服务端按幂等键去重
    return status === undefined || status === 408 || status === 502 || status === 503 || status === 504;
}

/** 上传图片并创建任务；网络中断时用同一幂等键重试 */
export async function createImportTask(input: CreateImportTaskInput, clientRequestId = newClientRequestId()): Promise<ImportTaskDetail> {
    let lastError: unknown;
    for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt++) {
        try {
            const { task } = await apiClient.post<{ task: ImportTaskDetail }>("/api/import-tasks", {
                ...input,
                clientRequestId,
                subjectId: input.subjectId || undefined,
                targetSubjectId: input.targetSubjectId || undefined,
                paperLevel: input.paperLevel || undefined,
            }, { timeout: UPLOAD_TIMEOUT_MS });
            notifyImportTasksChanged();
            return task;
        } catch (error) {
            lastError = error;
            if (!isRetryableUploadError(error) || attempt === UPLOAD_ATTEMPTS - 1) break;
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
    throw lastError;
}

/** 读取任务；状态轮询不带图片，校对页加载时传 image: true 取一次图片 */
export async function fetchImportTask(id: string, options: { image?: boolean } = {}): Promise<ImportTaskDetail> {
    const query = options.image ? "?include=image" : "";
    const { task } = await apiClient.get<{ task: ImportTaskDetail }>(`/api/import-tasks/${encodeURIComponent(id)}${query}`);
    return task;
}

export function fetchImportTasks(): Promise<ImportTaskListResponse> {
    return apiClient.get<ImportTaskListResponse>("/api/import-tasks");
}

export interface ConfirmImportTaskResponse {
    id: string;
    duplicate?: boolean;
    alreadySaved?: boolean;
    importTask?: ImportTaskSummary;
}

export async function confirmImportTask(id: string, payload: Record<string, unknown>): Promise<ConfirmImportTaskResponse> {
    const result = await apiClient.post<ConfirmImportTaskResponse>(`/api/import-tasks/${encodeURIComponent(id)}/confirm`, payload);
    notifyImportTasksChanged();
    return result;
}

export async function retryImportTask(id: string): Promise<ImportTaskDetail> {
    const { task } = await apiClient.post<{ task: ImportTaskDetail }>(`/api/import-tasks/${encodeURIComponent(id)}/retry`, {});
    notifyImportTasksChanged();
    return task;
}

export async function markImportTaskRead(id: string): Promise<void> {
    await apiClient.post(`/api/import-tasks/${encodeURIComponent(id)}/read`, {});
    notifyImportTasksChanged();
}

export async function discardImportTask(id: string): Promise<void> {
    await apiClient.delete(`/api/import-tasks/${encodeURIComponent(id)}`);
    notifyImportTasksChanged();
}

/**
 * 页面可见性刷新：回到前台（解锁、切回应用、从后台恢复的页面）时立即调用 refresh。
 * 返回取消监听的函数。
 */
export function onReturnToForeground(refresh: () => void): () => void {
    const onVisibility = () => {
        if (document.visibilityState === "visible") refresh();
    };
    const onPageShow = (event: PageTransitionEvent) => {
        if (event.persisted) refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", refresh);
    return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("focus", refresh);
        window.removeEventListener("pageshow", onPageShow);
        window.removeEventListener("online", refresh);
    };
}
