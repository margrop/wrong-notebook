"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Shapes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { useRunningTask } from "@/lib/hooks/use-running-task";
import { apiClient, ApiError } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { toast } from "@/lib/feedback";

interface RegenerateFigureButtonProps {
    errorItemId: string;
    /** 生成完成后回调新的配图（无配图时为 null） */
    onDone: (figure: { hasFigure: boolean; figureSvg: string | null }) => void;
}

/** 用原题图片让 AI 重新绘制 SVG 配图 */
export function RegenerateFigureButton({ errorItemId, onDone }: RegenerateFigureButtonProps) {
    const { t } = useLanguage();
    const [running, setRunning] = useState(false);
    const target = `error-item:${errorItemId}:figure`;
    const { running: taskRunning, refresh } = useRunningTask(target);
    // 任务从进行中变为结束后刷新数据（结果已由服务端写入数据库，onDone 触发父组件重新加载）
    const wasRunning = useRef(false);
    useEffect(() => {
        if (taskRunning) {
            wasRunning.current = true;
            return;
        }
        if (wasRunning.current) {
            wasRunning.current = false;
            // 任务结束后重新加载该错题数据，使服务端已保存的配图显示出来
            apiClient.get<{ hasFigure: boolean; figureSvg: string | null }>(`/api/error-items/${errorItemId}`)
                .then((item) => onDone({ hasFigure: item.hasFigure, figureSvg: item.figureSvg }))
                .catch((error) => frontendLogger.warn("[RegenerateFigure]", "Failed to reload figure", { error }));
        }
    }, [taskRunning, errorItemId, onDone]);

    const handleClick = async () => {
        setRunning(true);
        try {
            const figure = await apiClient.post<{ hasFigure: boolean; figureSvg: string | null }>(`/api/error-items/${errorItemId}/figure`, {}, { recoverable: true });
            onDone(figure);
            if (!figure.figureSvg) toast.warning(t.figure.noFigure);
        } catch (error) {
            if (error instanceof ApiError && error.status === 409 && (error.data as { code?: string })?.code === "TASK_ALREADY_RUNNING") {
                toast.info(t.errors.TASK_ALREADY_RUNNING);
                await refresh();
            } else {
                const code = (error as { data?: { message?: string } })?.data?.message || "";
                const mapped = (t.errors as Record<string, unknown>)[code];
                frontendLogger.error('[RegenerateFigure]', 'Failed to regenerate figure', { code });
                toast.error(code === "NO_ORIGINAL_IMAGE" ? t.figure.noImage : typeof mapped === "string" ? mapped : t.figure.failed);
            }
        } finally {
            setRunning(false);
        }
    };

    const busy = running || !!taskRunning;
    return (
        <Button variant="outline" size="sm" onClick={handleClick} disabled={busy} className="flex items-center gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shapes className="h-4 w-4" />}
            {busy ? t.figure.regenerating : t.figure.regenerate}
        </Button>
    );
}
