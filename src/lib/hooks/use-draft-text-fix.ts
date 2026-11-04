"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRunningTask } from "@/lib/hooks/use-running-task";
import { getAnalysisErrorMessage } from "@/lib/question/analysis-error";
import { ApiError, createRequestId, recoverResponse } from "@/lib/api-client";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { fixImportBatchText } from "@/lib/import/import-batch-client";
import type { BatchDraft } from "@/lib/question-split/draft";
import { applyTextFixes } from "@/lib/question-split/draft-ops";
import type { TextFixSuggestion } from "@/lib/question-split/draft-ops";

/** sessionStorage 中记录本次修正的 requestId 与 keys，键含批次 id */
function storageKey(batchId: string) {
    return `import-batch-text-fix:${batchId}`;
}

interface StoredFixRequest {
    requestId: string;
    keys: string[];
}

function readStoredFixRequest(batchId: string): StoredFixRequest | null {
    try {
        const raw = sessionStorage.getItem(storageKey(batchId));
        return raw ? (JSON.parse(raw) as StoredFixRequest) : null;
    } catch {
        return null;
    }
}

function writeStoredFixRequest(batchId: string, value: StoredFixRequest) {
    try {
        sessionStorage.setItem(storageKey(batchId), JSON.stringify(value));
    } catch {
        // sessionStorage 不可用时静默失败
    }
}

function clearStoredFixRequest(batchId: string) {
    try {
        sessionStorage.removeItem(storageKey(batchId));
    } catch {
        // sessionStorage 不可用时静默失败
    }
}

/**
 * 分题预览中的「AI 修正文字」：把若干题的当前文字交给服务端修正，返回的建议作为一次可撤销的编辑写入草稿。
 * 修正期间仍可编辑；建议只写入文字没再改动过的题。
 *
 * 防重复：按钮禁用条件为本页 fixingKeys 或 useRunningTask(target).running；
 * 发起前把 requestId 与 keys 记到 sessionStorage，刷新后若 running 且 sessionStorage 有 requestId，
 * 用 api-client 的恢复逻辑（/api/requests/:id 轮询）取回原响应并 applyTextFixes；
 * 若无 requestId（如另一台设备），等待任务结束后恢复按钮可用并提示结果未同步到此页。
 * 收到 TASK_ALREADY_RUNNING 时提示并进入等待；完成或失败后清除 sessionStorage 记录。
 */
export function useDraftTextFix(batchId: string, draft: BatchDraft, onEdit: (change: (draft: BatchDraft) => BatchDraft) => void) {
    const { t } = useLanguage();
    const [fixingKeys, setFixingKeys] = useState<string[]>([]);
    const target = `import-batch:${batchId}:fix-text`;
    const { running, refresh } = useRunningTask(target);
    // 记录本页发起的请求：running 且非本页发起时提示「其他页面完成」
    const initiatedHere = useRef(false);
    // 任务结束后是否已提示过「其他页面完成」
    const notifiedOtherDevice = useRef(false);
    // 刷新后是否已通过 requestId 取回结果
    const recoveredHere = useRef(false);

    const applyResult = useCallback((result: { fixes: TextFixSuggestion[]; unchanged: string[]; failed: string[] }) => {
        if (result.fixes.length > 0) onEdit((current) => applyTextFixes(current, result.fixes));
        const messages = [
            result.fixes.length > 0 ? t.importBatch.fixText.done.replace("{count}", String(result.fixes.length)) : null,
            result.unchanged.length > 0 ? t.importBatch.fixText.unchanged.replace("{count}", String(result.unchanged.length)) : null,
            result.failed.length > 0 ? t.importBatch.fixText.failed.replace("{count}", String(result.failed.length)) : null,
        ].filter(Boolean).join(" ");
        if (result.failed.length > 0) toast.warning(messages);
        else toast.success(messages);
    }, [onEdit, t]);

    const fix = useCallback(async (keys: string[]) => {
        const items = draft.items.filter((item) => keys.includes(item.key) && item.text.trim()).map((item) => ({ key: item.key, text: item.text }));
        if (items.length === 0) return;
        const requestId = createRequestId();
        writeStoredFixRequest(batchId, { requestId, keys: items.map((item) => item.key) });
        setFixingKeys(items.map((item) => item.key));
        initiatedHere.current = true;
        try {
            const result = await fixImportBatchText(batchId, items, requestId);
            applyResult(result);
        } catch (error) {
            if (error instanceof ApiError && error.status === 409 && (error.data as { code?: string })?.code === "TASK_ALREADY_RUNNING") {
                // 已有同 target 任务在运行：提示并进入等待（refresh 已把任务取到 store）
                toast.info(t.errors.TASK_ALREADY_RUNNING);
                await refresh();
            } else {
                frontendLogger.error("[ImportBatch]", "Text fix failed", { error });
                toast.error(getAnalysisErrorMessage(error, t));
            }
        } finally {
            setFixingKeys([]);
        }
    }, [batchId, draft, applyResult, refresh, t]);

    // 刷新后恢复：running 且 sessionStorage 有 requestId 时轮询 /api/requests/:id 取回原响应
    useEffect(() => {
        if (!running) return;
        const stored = readStoredFixRequest(batchId);
        if (stored?.requestId && !initiatedHere.current) {
            // 等待任务结束（最长 10 分钟，与 fix-text 超时一致），同时轮询暂存的响应
            const deadline = Date.now() + 10 * 60 * 1000;
            recoverResponse<{ fixes: TextFixSuggestion[]; unchanged: string[]; failed: string[] }>(
                stored.requestId,
                deadline,
                new Error("REQUEST_NOT_FOUND"),
            )
                .then((result) => {
                    recoveredHere.current = true;
                    applyResult(result);
                    clearStoredFixRequest(batchId);
                })
                .catch((error) => {
                    // 取回失败（请求过期或服务重启）：等待任务结束后提示「结果未同步到此页」
                    frontendLogger.warn("[ImportBatch]", "Text fix recovery failed", { error });
                });
        }
    }, [running, batchId, applyResult]);

    // 任务从进行中变为结束时：清除 sessionStorage；若非本页发起且未取回结果，提示「其他页面完成」。
    // 只在「进行中 → 结束」的转换时处理：页面刚加载、任务状态尚未取回时 running 也为 null，不能当作结束。
    const wasRunning = useRef(false);
    useEffect(() => {
        if (running) {
            wasRunning.current = true;
            notifiedOtherDevice.current = false;
            return;
        }
        if (!wasRunning.current) return;
        wasRunning.current = false;
        clearStoredFixRequest(batchId);
        if (!initiatedHere.current && !recoveredHere.current && !notifiedOtherDevice.current) {
            notifiedOtherDevice.current = true;
            toast.info(t.importBatch.fixText.waitingOtherDevice);
        }
        initiatedHere.current = false;
        recoveredHere.current = false;
    }, [running, batchId, t]);

    return { fix, fixingKeys, fixing: fixingKeys.length > 0 || !!running };
}
