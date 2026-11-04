"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { useIsClient } from "@/lib/hooks/use-is-client";

export type ProgressStatus = 'reading' | 'converting' | 'compressing' | 'uploading' | 'analyzing' | 'processing' | 'saving' | 'idle';

/** 已完成阶段的实际用时 */
export interface CompletedStage {
    label: string;
    ms: number;
}

interface ProgressFeedbackProps {
    status: ProgressStatus;
    message?: string;
    className?: string;
    /** 本次处理中已完成的阶段及用时 */
    completed?: CompletedStage[];
}

type ActiveProgressStatus = Exclude<ProgressStatus, 'idle'>;
type ActiveProgressFeedbackProps = Omit<ProgressFeedbackProps, 'status'> & { status: ActiveProgressStatus };

// 按处理阶段估算整体流程位置，同一阶段内保持固定值。
const STAGE_ESTIMATES: Record<ActiveProgressStatus, number> = {
    reading: 3,
    converting: 6,
    compressing: 10,
    uploading: 20,
    analyzing: 50,
    processing: 85,
    saving: 95,
};

function formatElapsedTime(seconds: number): string {
    const parts = [Math.floor(seconds / 60) % 60, seconds % 60];
    if (seconds >= 3600) parts.unshift(Math.floor(seconds / 3600));
    return parts.map((part) => String(part).padStart(2, '0')).join(':');
}

export function ProgressFeedback({ status, message, className, completed }: ProgressFeedbackProps) {
    // 确保只在客户端挂载完成后才渲染遮罩层，防止 SSR/Hydration 问题
    const isMounted = useIsClient();

    // 只有在客户端挂载完成且 status 不为 idle 时才渲染
    if (!isMounted || status === 'idle') return null;

    // 进入 idle 后卸载计时器，新任务重新挂载；切换阶段时保留本次任务的起点。
    return <ActiveProgressFeedback status={status} message={message} className={className} completed={completed} />;
}

function formatStageDuration(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function ActiveProgressFeedback({ status, message, className, completed }: ActiveProgressFeedbackProps) {
    const { t } = useLanguage();
    const [startedAt] = useState(() => Date.now());
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        }, 1000);
        return () => clearInterval(timer);
    }, [startedAt]);

    const progress = STAGE_ESTIMATES[status];
    const estimateLabel = t.common.progress.estimated.replace('{percent}', String(progress));

    return (
        <div className={cn(
            "fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm",
            className
        )}>
            <div className="w-full max-w-md p-6 space-y-6 bg-card rounded-lg border shadow-lg mx-4">
                <div className="flex flex-col items-center justify-center space-y-4 text-center">
                    <div className="relative">
                        <Loader2 className="h-12 w-12 animate-spin text-primary" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            {/* Optional: Add an icon inside the spinner if needed */}
                        </div>
                    </div>

                    <div className="space-y-2 w-full">
                        <h3 className="text-lg font-semibold tracking-tight" aria-live="polite">
                            {message || t.common.progress[status]}
                        </h3>
                        <Progress value={progress} aria-label={estimateLabel} aria-valuetext={estimateLabel} className="h-2 w-full" />
                    </div>

                    <div className="flex w-full flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground tabular-nums">
                        <span>{estimateLabel}</span>
                        <span role="timer" aria-live="off">{t.common.progress.elapsed.replace('{time}', formatElapsedTime(elapsedSeconds))}</span>
                    </div>
                    {completed && completed.length > 0 && (
                        <ul className="flex w-full flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums" data-testid="progress-stages">
                            {completed.map((stage) => (
                                <li key={stage.label}>{stage.label} {formatStageDuration(stage.ms)}</li>
                            ))}
                        </ul>
                    )}
                    <p className="text-xs text-muted-foreground">{t.common.progress.estimateHint}</p>
                </div>
            </div>
        </div>
    );
}

