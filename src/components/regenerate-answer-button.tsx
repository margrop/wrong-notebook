"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { ApiError, apiClient } from "@/lib/api-client";
import { useRunningTask } from "@/lib/hooks/use-running-task";
import { frontendLogger } from "@/lib/frontend-logger";
import { toast, confirmDialog } from "@/lib/feedback";

/** 完整解答较长，等待上限与生成动画讲解一致 */
const REANSWER_TIMEOUT_MS = 10 * 60 * 1000;

interface RegenerateAnswerButtonProps {
    errorItemId: string;
    /** 生成并保存后回调新的答案和解析（服务端已写库，上层据此刻重新加载数据） */
    onDone: (updated: { answerText: string | null; analysis: string | null }) => void;
    /** 任务结束后重新加载页面数据（刷新页面后等待场景，服务端已保存结果） */
    onReload?: () => void;
}

/** 用 AI 重新生成完整的答案和解析（覆盖前二次确认） */
export function RegenerateAnswerButton({ errorItemId, onDone, onReload }: RegenerateAnswerButtonProps) {
    const { t, language } = useLanguage();
    const [running, setRunning] = useState(false);
    // 按目标防重复：刷新页面后若任务仍在进行，按钮显示进行中并禁用
    const target = `error-item:${errorItemId}:reanswer`;
    const { running: backgroundRunning, refresh } = useRunningTask(target);
    // 本次点击是否由本页发起（任务结束时避免重复触发 onReload）
    const initiatedHere = useRef(false);
    // 上一轮是否仍显示进行中（用于检测「刷新后等待的任务已结束」）
    const wasRunning = useRef(false);

    const handleClick = async () => {
        if (!(await confirmDialog(t.reanswerItem.confirm))) return;
        setRunning(true);
        initiatedHere.current = true;
        try {
            const updated = await apiClient.post<{ answerText: string | null; analysis: string | null }>(
                `/api/error-items/${errorItemId}/reanswer`, { language }, { timeout: REANSWER_TIMEOUT_MS, recoverable: true }
            );
            onDone(updated);
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
                frontendLogger.error('[RegenerateAnswer]', 'Failed to regenerate answer', { code });
                toast.error(code === "NO_QUESTION_TEXT" ? t.reanswerItem.noQuestionText : typeof mapped === "string" ? mapped : t.reanswerItem.failed);
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
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <WandSparkles className="h-4 w-4 mr-1" />}
            {busy ? t.reanswerItem.running : t.reanswerItem.button}
        </Button>
    );
}
