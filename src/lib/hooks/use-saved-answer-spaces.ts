"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeCustomAnswerSpacePx } from "@/lib/exam/exam-answer-space";
import { frontendLogger } from "@/lib/frontend-logger";

/** 一道题的留白改动；answerSpacePx 为 null 表示恢复按全局档位 */
export interface AnswerSpaceChange {
    id: string;
    answerSpacePx: number | null;
}

interface AnswerSpaceSource {
    id: string;
    answerSpacePx?: number | null;
}

/** 拖动滑块时合并连续改动，停顿后再保存 */
const SAVE_DELAY_MS = 600;

/**
 * 单题手动留白：以服务端保存的值为初值，本地改动立即生效并延迟批量保存，
 * 下次打开打印页时直接沿用。
 */
export function useSavedAnswerSpaces(
    items: readonly AnswerSpaceSource[],
    save: (changes: AnswerSpaceChange[]) => Promise<void>,
) {
    const [overrides, setOverrides] = useState<Record<string, number | null>>({});
    const [saveFailed, setSaveFailed] = useState(false);
    const pendingRef = useRef(new Map<string, number | null>());
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveRef = useRef(save);

    useEffect(() => {
        saveRef.current = save;
    }, [save]);

    const customSpaces = useMemo(() => {
        const result: Record<string, number> = {};
        for (const item of items) {
            const px = item.id in overrides ? overrides[item.id] : normalizeCustomAnswerSpacePx(item.answerSpacePx);
            if (typeof px === "number") result[item.id] = px;
        }
        return result;
    }, [items, overrides]);

    const flush = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (pendingRef.current.size === 0) return;
        const changes = Array.from(pendingRef.current, ([id, answerSpacePx]) => ({ id, answerSpacePx }));
        pendingRef.current.clear();
        saveRef.current(changes)
            .then(() => setSaveFailed(false))
            .catch((error: unknown) => {
                setSaveFailed(true);
                frontendLogger.error("[AnswerSpace]", "Failed to save answer space", { error });
            });
    }, []);

    // 离开页面前把尚未保存的改动发出去
    useEffect(() => flush, [flush]);

    const queue = useCallback((changes: AnswerSpaceChange[], immediate: boolean) => {
        if (changes.length === 0) return;
        setOverrides((prev) => {
            const next = { ...prev };
            for (const { id, answerSpacePx } of changes) next[id] = answerSpacePx;
            return next;
        });
        for (const { id, answerSpacePx } of changes) pendingRef.current.set(id, answerSpacePx);
        if (immediate) {
            flush();
            return;
        }
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(flush, SAVE_DELAY_MS);
    }, [flush]);

    /** 调整或恢复单题留白（null 为恢复默认） */
    const setSpace = useCallback((id: string, px: number | null) => {
        queue([{ id, answerSpacePx: px }], px === null);
    }, [queue]);

    /** 清除全部手动留白 */
    const resetAll = useCallback(() => {
        queue(Object.keys(customSpaces).map((id) => ({ id, answerSpacePx: null })), true);
    }, [customSpaces, queue]);

    return { customSpaces, setSpace, resetAll, saveFailed };
}
