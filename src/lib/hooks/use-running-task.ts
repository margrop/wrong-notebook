"use client";

import { useEffect, useState } from "react";
import { backgroundTaskStore } from "@/lib/background-task-store";
import type { BackgroundTask } from "@/lib/background-tasks";

export interface UseRunningTaskResult {
    /** 当前用户在指定 target 上正在运行的任务；没有则为 null */
    running: BackgroundTask | null;
    /** 手动刷新一次任务列表（收到 TASK_ALREADY_RUNNING 后调用进入等待） */
    refresh: () => Promise<void>;
}

/**
 * 查询当前用户在指定 target 上正在运行的后台任务。
 * 与「后台任务」按钮共用同一份轮询结果（backgroundTaskStore），不额外发起请求。
 * 任务结束时 running 从任务对象变为 null，调用方据此刷新页面数据。
 */
export function useRunningTask(target: string | null): UseRunningTaskResult {
    const [tasks, setTasks] = useState<BackgroundTask[]>(() => backgroundTaskStore.getSnapshot());

    useEffect(() => {
        if (!target) return;
        return backgroundTaskStore.subscribe(setTasks);
    }, [target]);

    const running = target ? (tasks.find((task) => task.status === "running" && task.target === target) ?? null) : null;
    return { running, refresh: () => backgroundTaskStore.refresh() };
}
