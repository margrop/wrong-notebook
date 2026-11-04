"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { conflictBatch, fetchImportBatch, saveImportBatchDraft } from "@/lib/import/import-batch-client";
import type { ImportBatchDetail } from "@/lib/import/import-batch-types";
import { onReturnToForeground } from "@/lib/import/import-task-client";
import type { BatchDraft } from "@/lib/question-split/draft";

/** 分题或解析进行中的轮询间隔 */
const ACTIVE_POLL_MS = 2500;
/** 编辑后自动保存的延迟 */
const SAVE_DELAY_MS = 800;
/** 撤销记录的条数 */
const MAX_UNDO = 30;
/** 保存失败（网络等）后自动重试的间隔 */
const RETRY_DELAY_MS = 5000;

export type DraftSaveState = "saved" | "dirty" | "saving" | "error";

/**
 * 单个多题批次：进行中时轮询，回到前台立即刷新；草稿编辑后自动保存到服务端（带版本号）。
 * 本地有未保存的修改时，轮询结果不会覆盖正在编辑的草稿；其他页面先保存了修改时载入最新内容并通过 onConflict 提示，
 * 本页的修改保留为可恢复的副本（conflictCopy），由用户选择恢复或放弃。
 * 保存串行进行：防抖、页面隐藏、开始按钮等同时触发时合并为同一个保存循环，每次提交最新内容和最新版本，不会自己与自己冲突。
 */
export function useImportBatch(id: string, options: { onConflict?: () => void } = {}) {
    const [batch, setBatch] = useState<ImportBatchDetail | null>(null);
    const [notFound, setNotFound] = useState(false);
    const [draft, setDraft] = useState<BatchDraft | null>(null);
    const [saveState, setSaveState] = useState<DraftSaveState>("saved");
    const undoStack = useRef<BatchDraft[]>([]);
    const [canUndo, setCanUndo] = useState(false);
    // 已保存到服务端的版本与「本地修改编号」，用于判断保存期间是否又有新修改
    const versionRef = useRef(0);
    const editSeq = useRef(0);
    const savedSeq = useRef(0);
    const draftRef = useRef<BatchDraft | null>(null);
    const saving = useRef<Promise<boolean> | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveRef = useRef<() => Promise<boolean>>(async () => true);
    const [conflictCopy, setConflictCopy] = useState<BatchDraft | null>(null);
    const onConflictRef = useRef(options.onConflict);
    useEffect(() => {
        onConflictRef.current = options.onConflict;
    }, [options.onConflict]);

    /** 采用服务端的批次；本地没有未保存修改时同时采用其草稿 */
    const adopt = useCallback((next: ImportBatchDetail, force = false) => {
        setBatch((current) => (current && !next.imageData && current.imageData && current.id === next.id ? { ...next, imageData: current.imageData } : next));
        const dirty = editSeq.current !== savedSeq.current;
        if (force || !dirty || next.status !== "draft") {
            if (draftRef.current !== null && next.version !== versionRef.current) {
                // 草稿被替换为服务端的另一版本时，旧的撤销记录不再适用
                undoStack.current = [];
                setCanUndo(false);
            }
            versionRef.current = next.version;
            draftRef.current = next.draft;
            setDraft(next.draft);
            savedSeq.current = editSeq.current;
            setSaveState("saved");
        }
    }, []);

    const refresh = useCallback(async () => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        try {
            adopt(await fetchImportBatch(id));
            setNotFound(false);
        } catch (error) {
            if ((error as { status?: number })?.status === 404) setNotFound(true);
        }
    }, [id, adopt]);

    // 首次加载带整页图片（图片批次的预览需要）
    useEffect(() => {
        let cancelled = false;
        fetchImportBatch(id, { image: true })
            .then((detail) => {
                if (!cancelled) adopt(detail, true);
            })
            .catch((error: unknown) => {
                if (!cancelled && (error as { status?: number })?.status === 404) setNotFound(true);
            });
        const stop = onReturnToForeground(() => void refresh());
        return () => {
            cancelled = true;
            stop();
        };
    }, [id, adopt, refresh]);

    const active = batch?.phase === "splitting" || batch?.phase === "processing";
    useEffect(() => {
        if (!active) return;
        const interval = setInterval(() => void refresh(), ACTIVE_POLL_MS);
        return () => clearInterval(interval);
    }, [active, refresh]);

    /** 提交一次当前草稿与当前版本 */
    const saveOnce = useCallback(async (): Promise<"ok" | "conflict" | "error"> => {
        const seq = editSeq.current;
        setSaveState("saving");
        try {
            const next = await saveImportBatchDraft(id, versionRef.current, draftRef.current!);
            versionRef.current = next.version;
            savedSeq.current = seq;
            setBatch((current) => (current ? { ...next, imageData: current.imageData } : next));
            setSaveState(editSeq.current === seq ? "saved" : "dirty");
            return "ok";
        } catch (error) {
            const latest = conflictBatch(error);
            if (latest) {
                // 其他页面已修改或已开始：载入最新内容；本页的修改（含保存期间新输入的）保留为可恢复的副本
                const local = draftRef.current;
                if (latest.status === "draft" && local) setConflictCopy(local);
                adopt(latest, true);
                onConflictRef.current?.();
                return "conflict";
            }
            setSaveState("error");
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => void saveRef.current(), RETRY_DELAY_MS);
            return "error";
        }
    }, [id, adopt]);

    /** 立即保存当前草稿；同时发起的保存合并为一个串行循环，返回是否已与服务端一致 */
    const save = useCallback(async (): Promise<boolean> => {
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }
        for (;;) {
            const run = saving.current ?? (saving.current = (async () => {
                try {
                    while (editSeq.current !== savedSeq.current && draftRef.current) {
                        if (await saveOnce() !== "ok") return false;
                    }
                    return true;
                } finally {
                    saving.current = null;
                }
            })());
            if (!await run) return false;
            // 等待期间又有新修改且循环已结束时，再保存一轮
            if (editSeq.current === savedSeq.current) return true;
        }
    }, [saveOnce]);
    useEffect(() => {
        saveRef.current = save;
    }, [save]);

    // 页面隐藏（锁屏、切换应用、关闭）前尽快保存
    useEffect(() => {
        const flush = () => {
            if (document.visibilityState === "hidden" && editSeq.current !== savedSeq.current) void save();
        };
        document.addEventListener("visibilitychange", flush);
        window.addEventListener("pagehide", flush);
        return () => {
            document.removeEventListener("visibilitychange", flush);
            window.removeEventListener("pagehide", flush);
        };
    }, [save]);

    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
    }, []);

    /** 采用本地修改后的草稿，稍后自动保存 */
    const apply = useCallback((next: BatchDraft) => {
        draftRef.current = next;
        setDraft(next);
        editSeq.current += 1;
        setSaveState("dirty");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    }, [save]);

    // 连续输入同一处文字时只记一条撤销记录
    const lastGroup = useRef<{ group: string; at: number } | null>(null);

    /** 应用一次编辑并记入撤销；group 相同的连续编辑（如逐字输入）合并为一条 */
    const edit = useCallback((change: (current: BatchDraft) => BatchDraft, group?: string) => {
        const current = draftRef.current;
        if (!current) return;
        const next = change(current);
        if (next === current) return;
        const now = Date.now();
        const merged = group && lastGroup.current?.group === group && now - lastGroup.current.at < 1500;
        lastGroup.current = group ? { group, at: now } : null;
        if (!merged) {
            undoStack.current = [...undoStack.current.slice(-(MAX_UNDO - 1)), current];
            setCanUndo(true);
        }
        apply(next);
    }, [apply]);

    const undo = useCallback(() => {
        const previous = undoStack.current.pop();
        lastGroup.current = null;
        setCanUndo(undoStack.current.length > 0);
        if (previous) apply(previous);
    }, [apply]);

    /** 保存冲突后恢复本页的修改：在最新版本上作为一次编辑重新保存 */
    const restoreConflictCopy = useCallback(() => {
        const copy = conflictCopy;
        setConflictCopy(null);
        if (copy) edit(() => copy);
    }, [conflictCopy, edit]);

    return {
        batch, draft, notFound, saveState, refresh, save, edit, undo, canUndo,
        conflictCopy, restoreConflictCopy, dismissConflictCopy: () => setConflictCopy(null),
        /** 当前已保存的版本（开始解析时提交） */
        version: () => versionRef.current,
        replace: (next: ImportBatchDetail) => adopt(next, true),
    };
}
