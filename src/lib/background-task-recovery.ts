/**
 * 耗时 AI 请求的断线恢复。
 *
 * 部分浏览器（如 iPhone 上的 Safari）会在服务端返回前中断等待较久的请求，fetch 抛出网络错误（如 “Load failed”），
 * 但服务端仍会继续执行并保存结果，进度登记在后台任务中。此时改为轮询后台任务，任务结束后再取回结果。
 */
import { apiClient } from "@/lib/api-client";
import type { BackgroundTask, BackgroundTaskKind } from "@/lib/background-tasks";

const POLL_INTERVAL_MS = 3000;
/** 请求发出后多久仍查不到对应任务，视为请求没有到达服务端 */
const TASK_APPEAR_GRACE_MS = 6000;
/** 手机与服务器的时钟可能不一致，匹配任务开始时间时放宽的范围 */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** 请求没有收到服务端响应（网络中断）；超时（408）和服务端返回的错误不算 */
export function isNetworkError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    if ("status" in error) return false;
    return error instanceof TypeError || (error as { name?: unknown }).name === "TypeError";
}

export type TaskOutcome = { status: "succeeded" } | { status: "failed"; error: string | null };

interface WaitOptions {
    kind: BackgroundTaskKind;
    link: string;
    /** 请求发出的时间（本机时钟） */
    since: number;
    timeoutMs: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 轮询后台任务，等待该页面最近一次同类任务结束；查不到对应任务或等待超时时返回 null
 */
export async function waitForBackgroundTask({ kind, link, since, timeoutMs }: WaitOptions): Promise<TaskOutcome | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        let task: BackgroundTask | undefined;
        try {
            const { tasks } = await apiClient.get<{ tasks: BackgroundTask[] }>("/api/tasks");
            task = tasks
                .filter((t) => t.kind === kind && t.link === link && Date.parse(t.startedAt) >= since - CLOCK_SKEW_MS)
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
        } catch {
            // 查询失败时稍后重试
        }
        if (task?.status === "succeeded") return { status: "succeeded" };
        if (task?.status === "failed") return { status: "failed", error: task.error };
        if (!task && Date.now() - since > TASK_APPEAR_GRACE_MS) return null;
        await sleep(POLL_INTERVAL_MS);
    }
    return null;
}
