"use client";

import { AlertCircle, CheckCircle2, Clock3, Loader2, PencilLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { formatDateTime } from "@/lib/date-time";
import { formatDuration, listTimingStages } from "@/lib/import/import-task-format";
import type { ImportTaskSummary } from "@/lib/import/import-task-types";
import { cn } from "@/lib/utils";

interface ImportTaskCardProps {
    task: ImportTaskSummary;
    /** 执行中任务的实时用时基准（毫秒时间戳） */
    now?: number;
    onReview?: () => void;
    onViewItem?: () => void;
    onRetry?: () => void;
    onDiscard?: () => void;
}

/** 服务端阶段在整体流程中的估算位置（上传前的阶段已在页面遮罩中显示） */
const STAGE_ESTIMATES = { analyzing: 50, saving: 90 } as const;

const STATUS_ICON = {
    analyzing: Loader2,
    saving: Loader2,
    review: PencilLine,
    saved: CheckCircle2,
    failed: AlertCircle,
} as const;

/** 识别任务卡片：状态文字、题干摘要、各阶段用时与可用操作 */
export function ImportTaskCard({ task, now, onReview, onViewItem, onRetry, onDiscard }: ImportTaskCardProps) {
    const { t } = useLanguage();
    const { timeZone } = useTimeZone();
    const Icon = STATUS_ICON[task.status];
    const active = task.status === "analyzing" || task.status === "saving";
    const errors = t.errors as Record<string, unknown>;
    const errorText = task.error ? (typeof errors[task.error] === "string" ? errors[task.error] as string : task.error) : null;
    const stages = listTimingStages(task.timings);
    const elapsed = active && now ? now - Date.parse(task.createdAt) : null;

    return (
        <div className={cn("space-y-2 rounded-lg border p-3 text-sm", task.unread && "border-primary/50 bg-primary/5")} data-testid="import-task-card" data-status={task.status}>
            <div className="flex items-start gap-2">
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0",
                    active && "animate-spin text-primary",
                    task.status === "saved" && "text-green-600",
                    task.status === "failed" && "text-destructive",
                    task.status === "review" && "text-primary")} />
                <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{t.importTasks.status[task.status]}</span>
                        <span className="text-xs text-muted-foreground">{t.importTasks.mode[task.mode]}</span>
                        {task.unread && <Badge>{t.importTasks.unread}</Badge>}
                    </div>
                    {active && (
                        <Progress
                            value={STAGE_ESTIMATES[task.status as keyof typeof STAGE_ESTIMATES]}
                            aria-label={t.importTasks.stageEstimate}
                            aria-valuetext={t.common.progress.estimated.replace("{percent}", String(STAGE_ESTIMATES[task.status as keyof typeof STAGE_ESTIMATES]))}
                            className="h-1.5"
                        />
                    )}
                    {task.excerpt && <p className="break-words text-muted-foreground">{task.excerpt}</p>}
                    {task.status === "saved" && !task.errorItemId && (
                        <p className="text-xs text-muted-foreground">{t.importTasks.itemDeleted}</p>
                    )}
                    {task.status === "saved" && task.errorItemId && (
                        <p className="text-xs text-green-700 dark:text-green-300">
                            {task.duplicate
                                ? t.importTasks.duplicateSaved
                                : t.importTasks.savedTo.replace("{notebook}", task.notebookName || "-").replace("{id}", task.errorItemShortId || "-")}
                        </p>
                    )}
                    {errorText && <p className="text-xs text-destructive">{errorText}</p>}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <Clock3 className="h-3 w-3" />
                            {t.importTasks.createdAt.replace("{time}", formatDateTime(task.createdAt, "MM-dd HH:mm", timeZone))}
                        </span>
                        {elapsed !== null && <span>{t.importTasks.elapsed.replace("{time}", formatDuration(elapsed))}</span>}
                        {task.attempts > 1 && <span>{t.importTasks.attempts.replace("{count}", String(task.attempts))}</span>}
                    </div>
                    {stages.length > 0 && (
                        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums" aria-label="timings">
                            {stages.map(({ stage, ms }) => (
                                <li key={stage}>{t.importTasks.timings[stage]} {formatDuration(ms)}</li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
                {task.status === "review" && onReview && <Button size="sm" onClick={onReview}>{t.importTasks.continueReview}</Button>}
                {task.status === "saved" && task.errorItemId && onViewItem && (
                    <Button size="sm" variant="outline" onClick={onViewItem}>{t.importTasks.viewItem}</Button>
                )}
                {task.status === "failed" && onRetry && <Button size="sm" onClick={onRetry}>{t.importTasks.retry}</Button>}
                {task.status !== "saving" && task.status !== "saved" && onDiscard && (
                    <Button size="sm" variant="ghost" onClick={onDiscard}>{t.importTasks.discard}</Button>
                )}
            </div>
        </div>
    );
}
