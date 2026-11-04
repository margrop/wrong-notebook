"use client";

/**
 * 后台任务的共享轮询 store：页面右下角的「后台任务」按钮、useRunningTask 等
 * 所有需要 /api/tasks 数据的地方共用同一份轮询结果，避免每个组件各自定时请求。
 *
 * 轮询策略：有 running 任务时隔 3 秒刷新一次，否则放慢到 15 秒；
 * 页面不可见（visibilitychange 为 hidden）时暂停定时器，回到前台立即补一次。
 */

import { apiClient } from "@/lib/api-client";
import type { BackgroundTask } from "@/lib/background-tasks";

const RUNNING_POLL_MS = 3000;
const IDLE_POLL_MS = 15000;

type Listener = (tasks: BackgroundTask[]) => void;

interface BackgroundTaskStore {
    /** 当前缓存的任务列表（最近一次成功轮询结果） */
    getSnapshot: () => BackgroundTask[];
    /** 手动触发一次刷新（例如收到 TASK_ALREADY_RUNNING 后立刻取回 running 任务） */
    refresh: () => Promise<void>;
    /** 订阅任务列表变化；返回取消订阅函数 */
    subscribe: (listener: Listener) => () => void;
}

function createBackgroundTaskStore(): BackgroundTaskStore {
    let tasks: BackgroundTask[] = [];
    const listeners = new Set<Listener>();
    let started = false;
    let inFlight: Promise<void> | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const notify = () => {
        for (const listener of listeners) listener(tasks);
    };

    const poll = (respectVisibility = true): Promise<void> => {
        if (inFlight) return inFlight;
        if (respectVisibility && typeof document !== "undefined" && document.visibilityState === "hidden") return Promise.resolve();
        inFlight = (async () => {
            try {
                const result = await apiClient.get<{ tasks: BackgroundTask[] }>("/api/tasks");
                tasks = result.tasks;
                notify();
                reschedule();
            } catch {
                // 查询失败时保留上次结果，下次轮询再试
            } finally {
                inFlight = null;
            }
        })();
        return inFlight;
    };

    const reschedule = () => {
        if (timer) clearInterval(timer);
        const hasRunning = tasks.some((task) => task.status === "running");
        timer = setInterval(() => void poll(), hasRunning ? RUNNING_POLL_MS : IDLE_POLL_MS);
    };

    const startPolling = () => {
        if (started) return;
        started = true;
        void poll().then(reschedule).catch(() => undefined);
        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", handleVisibility);
        }
    };

    const handleVisibility = () => {
        if (document.visibilityState === "visible") {
            void poll().then(reschedule).catch(() => undefined);
        }
    };

    return {
        getSnapshot: () => tasks,
        refresh: async () => {
            startPolling();
            await poll(false);
            reschedule();
        },
        subscribe: (listener) => {
            listeners.add(listener);
            startPolling();
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

/** 全局唯一实例：模块级单例，挂在 globalThis 上避免开发环境热更新产生多个轮询器 */
const globalRef = globalThis as typeof globalThis & { __backgroundTaskStore?: BackgroundTaskStore };
export const backgroundTaskStore: BackgroundTaskStore = globalRef.__backgroundTaskStore ??= createBackgroundTaskStore();
