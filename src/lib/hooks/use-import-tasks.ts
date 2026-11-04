"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchImportTask, fetchImportTasks, IMPORT_TASKS_CHANGED_EVENT, onReturnToForeground } from "@/lib/import/import-task-client";
import type { ImportTaskDetail, ImportTaskListResponse } from "@/lib/import/import-task-types";

/** 有任务在执行时的轮询间隔 */
const ACTIVE_POLL_MS = 2500;
/** 没有执行中的任务时低频刷新（其他设备发起的任务、未读状态） */
const IDLE_POLL_MS = 30_000;

function isActive(status: string | undefined): boolean {
    return status === "analyzing" || status === "saving";
}

/** 当前用户的识别任务列表：执行中时高频轮询，回到前台或任务变化时立即刷新 */
export function useImportTaskList(enabled = true) {
    const [data, setData] = useState<ImportTaskListResponse | null>(null);
    const [error, setError] = useState(false);

    const refresh = useCallback(async () => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        try {
            setData(await fetchImportTasks());
            setError(false);
        } catch {
            // 保留上次结果，下次轮询再试
            setError(true);
        }
    }, []);

    useEffect(() => {
        if (!enabled) return;
        const first = setTimeout(refresh, 0);
        const stopForeground = onReturnToForeground(refresh);
        window.addEventListener(IMPORT_TASKS_CHANGED_EVENT, refresh);
        return () => {
            clearTimeout(first);
            stopForeground();
            window.removeEventListener(IMPORT_TASKS_CHANGED_EVENT, refresh);
        };
    }, [enabled, refresh]);

    const active = (data?.activeCount ?? 0) > 0;
    useEffect(() => {
        if (!enabled) return;
        const timer = setInterval(refresh, active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
        return () => clearInterval(timer);
    }, [enabled, active, refresh]);

    return { data, error, refresh };
}

/**
 * 单个任务：执行中时轮询，回到前台立即刷新；notFound 表示任务不存在或不属于当前用户。
 * onUpdate 在每次取回任务后调用（用于根据状态变化切换页面）。
 */
export function useImportTask(id: string | null, onUpdate?: (task: ImportTaskDetail) => void) {
    const [task, setTask] = useState<ImportTaskDetail | null>(null);
    const [notFound, setNotFound] = useState(false);
    const idRef = useRef(id);
    const onUpdateRef = useRef(onUpdate);
    useEffect(() => {
        idRef.current = id;
        onUpdateRef.current = onUpdate;
    }, [id, onUpdate]);

    const refresh = useCallback(async () => {
        const current = idRef.current;
        if (!current) return;
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        try {
            const next = await fetchImportTask(current);
            if (idRef.current === current) {
                setTask(next);
                setNotFound(false);
                onUpdateRef.current?.(next);
            }
        } catch (error) {
            if ((error as { status?: number })?.status === 404 && idRef.current === current) setNotFound(true);
        }
    }, []);

    useEffect(() => {
        if (!id) return;
        const first = setTimeout(refresh, 0);
        const stopForeground = onReturnToForeground(refresh);
        return () => {
            clearTimeout(first);
            stopForeground();
        };
    }, [id, refresh]);

    const active = isActive(task?.status);
    useEffect(() => {
        if (!id || !active) return;
        const timer = setInterval(refresh, ACTIVE_POLL_MS);
        return () => clearInterval(timer);
    }, [id, active, refresh]);

    return { task: task && task.id === id ? task : null, notFound, refresh, setTask };
}
