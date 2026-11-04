"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { ApiError, apiClient } from "@/lib/api-client";
import { useRunningTask } from "@/lib/hooks/use-running-task";
import { frontendLogger } from "@/lib/frontend-logger";
import { toast } from "@/lib/feedback";

type RetagItemButtonProps = {
    errorItemId: string;
    /** 任务结束后重新加载页面数据（刷新页面后等待场景，直接保存模式结果已由服务端写库） */
    onReload?: () => void;
} & (
    /** 直接保存：重新生成成功后回调，用于刷新题目 */
    | { onDone: () => void; onSuggested?: never }
    /** 预览：只把 AI 建议的知识点交给调用方（如填入编辑框），不保存 */
    | { onSuggested: (tags: string[]) => void; onDone?: never }
);

/** 单题用 AI 重新生成知识点 */
export function RetagItemButton({ errorItemId, onDone, onSuggested, onReload }: RetagItemButtonProps) {
    const { t } = useLanguage();
    const [running, setRunning] = useState(false);
    // 按目标防重复：刷新页面后若任务仍在进行，按钮显示进行中并禁用
    const target = `error-item:${errorItemId}:retag`;
    const { running: backgroundRunning, refresh } = useRunningTask(target);
    // 本次点击是否由本页发起（任务结束时避免重复触发 onReload）
    const initiatedHere = useRef(false);
    // 上一轮是否仍显示进行中（用于检测「刷新后等待的任务已结束」）
    const wasRunning = useRef(false);

    const handleClick = async () => {
        setRunning(true);
        initiatedHere.current = true;
        try {
            if (onSuggested) {
                const result = await apiClient.post<{ tags: string[] }>(`/api/error-items/${errorItemId}/retag`, { preview: true }, { recoverable: true });
                onSuggested(result.tags);
            } else {
                await apiClient.post(`/api/error-items/${errorItemId}/retag`, {}, { recoverable: true });
                onDone?.();
            }
        } catch (error) {
            if (error instanceof ApiError && error.status === 409 && (error.data as { code?: string })?.code === "TASK_ALREADY_RUNNING") {
                // 已有同 target 任务在运行：提示并进入等待（refresh 已把任务取到 store）
                toast.info(t.errors.TASK_ALREADY_RUNNING);
                // 等待的是其他页面发起的任务：结束时需要重新加载数据
                initiatedHere.current = false;
                await refresh();
            } else {
                const code = (error as { data?: { message?: string } })?.data?.message || "";
                const mapped = (t.errors as Record<string, unknown>)[code];
                frontendLogger.error('[RetagItem]', 'Failed to regenerate tags', { code });
                toast.error(code === "NO_TAGS_SELECTED" ? t.retag.noTags : typeof mapped === "string" ? mapped : t.retag.itemFailed);
            }
        } finally {
            setRunning(false);
        }
    };

    // 刷新页面后等待场景：任务结束（running 由任务对象变为 null）时结果已由服务端写库，通知上层重新加载
    useEffect(() => {
        if (backgroundRunning) {
            wasRunning.current = true;
            return;
        }
        if (wasRunning.current && !initiatedHere.current) {
            onReload?.();
        }
        wasRunning.current = false;
        initiatedHere.current = false;
    }, [backgroundRunning, onReload]);

    const busy = running || !!backgroundRunning;
    return (
        <Button variant="ghost" size="sm" onClick={handleClick} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            {onSuggested
                ? (busy ? t.retag.suggestRunning : t.retag.suggestButton)
                : (busy ? t.retag.itemRunning : t.retag.itemButton)}
        </Button>
    );
}
