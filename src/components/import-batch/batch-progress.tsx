"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2, PencilLine, RotateCcw } from "lucide-react";
import { RegionThumbnail } from "@/components/import-batch/region-thumbnail";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ImportBatchDetail } from "@/lib/import/import-batch-types";
import type { ImportTaskSummary } from "@/lib/import/import-task-types";
import { cn } from "@/lib/utils";

interface BatchProgressProps {
    batch: ImportBatchDetail;
    image: { url: string; width: number; height: number } | null;
    busy: boolean;
    onRetryFailed: () => void;
    onRetryOne: (task: ImportTaskSummary) => void;
    onConfirmAll: () => void;
}

/** 各状态在流程中的估算位置（阶段估计，不是模型的真实进度） */
const STAGE_ESTIMATE: Record<ImportTaskSummary["status"], number> = { analyzing: 0.5, saving: 0.9, review: 1, saved: 1, failed: 1 };

function StatusLine({ task }: { task: ImportTaskSummary }) {
    const { t } = useLanguage();
    const labels = t.importBatch.itemStatus;
    if (task.status === "saved") {
        const text = !task.errorItemId ? labels.deleted : task.duplicate ? labels.duplicate : labels.saved;
        return <span className="flex items-center gap-1 text-green-700 dark:text-green-300"><CheckCircle2 className="h-4 w-4" />{text}</span>;
    }
    if (task.status === "failed") return <span className="flex items-center gap-1 text-destructive"><AlertCircle className="h-4 w-4" />{labels.failed}</span>;
    if (task.status === "review") return <span className="flex items-center gap-1 text-primary"><PencilLine className="h-4 w-4" />{labels.review}</span>;
    return <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{labels[task.status]}</span>;
}

/** 开始解析后的统一进度与逐题结果：成功、重复、待校对、失败；只重试失败的题 */
export function BatchProgress({ batch, image, busy, onRetryFailed, onRetryOne, onConfirmAll }: BatchProgressProps) {
    const { t } = useLanguage();
    const { counts } = batch;
    const finished = counts.total - counts.active;
    const estimate = counts.total ? Math.round((batch.tasks.reduce((sum, task) => sum + STAGE_ESTIMATE[task.status], 0) / counts.total) * 100) : 0;
    const items = new Map((batch.draft?.items ?? []).map((item, index) => [item.key, { item, index }]));
    const errors = t.errors as Record<string, unknown>;

    return (
        <div className="space-y-4">
            <section className="space-y-3 rounded-xl border bg-card p-4" data-testid="batch-progress" data-phase={batch.phase}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-base font-semibold">{t.importBatch.progress.replace("{done}", String(finished)).replace("{total}", String(counts.total))}</p>
                    <p className="text-xs text-muted-foreground">{t.importTasks.stageEstimate}</p>
                </div>
                <Progress value={estimate} aria-label={t.importTasks.stageEstimate} aria-valuetext={t.common.progress.estimated.replace("{percent}", String(estimate))} className="h-2" />
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="batch-counts">
                    <li className="text-green-700 dark:text-green-300">{t.importBatch.counts.saved.replace("{count}", String(counts.saved - counts.duplicate))}</li>
                    {counts.duplicate > 0 && <li className="text-muted-foreground">{t.importBatch.counts.duplicate.replace("{count}", String(counts.duplicate))}</li>}
                    {counts.review > 0 && <li className="text-primary">{t.importBatch.counts.review.replace("{count}", String(counts.review))}</li>}
                    {counts.failed > 0 && <li className="text-destructive">{t.importBatch.counts.failed.replace("{count}", String(counts.failed))}</li>}
                    {counts.active > 0 && <li className="text-muted-foreground">{t.importBatch.counts.active.replace("{count}", String(counts.active))}</li>}
                </ul>
                {counts.active > 0 && <p className="text-xs text-muted-foreground">{t.importBatch.leaveHint}</p>}
                <div className="flex flex-wrap gap-2">
                    {counts.failed > 0 && (
                        <Button type="button" size="sm" onClick={onRetryFailed} disabled={busy}>
                            <RotateCcw className="mr-1 h-4 w-4" />{t.importBatch.retryFailed.replace("{count}", String(counts.failed))}
                        </Button>
                    )}
                    {counts.review > 0 && (
                        <Button type="button" size="sm" variant="outline" onClick={onConfirmAll} disabled={busy}>
                            {t.importBatch.confirmAll.replace("{count}", String(counts.review))}
                        </Button>
                    )}
                </div>
            </section>

            <ol className="space-y-3">
                {batch.tasks.map((task) => {
                    const entry = items.get(task.batchItemKey ?? "");
                    const error = task.error ? (typeof errors[task.error] === "string" ? errors[task.error] as string : task.error) : null;
                    return (
                        <li key={task.id} className={cn("flex gap-3 rounded-xl border bg-card p-3 text-sm", task.unread && task.status === "review" && "border-primary/50")} data-testid="batch-task" data-status={task.status}>
                            {image && entry && entry.item.regions.length > 0 && (
                                <RegionThumbnail imageUrl={image.url} imageSize={image} regions={entry.item.regions} className="w-20 shrink-0 self-start sm:w-28" />
                            )}
                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-medium">{t.importBatch.question.replace("{index}", String((entry?.index ?? 0) + 1))}</span>
                                    <StatusLine task={task} />
                                </div>
                                <p className="line-clamp-2 break-words text-muted-foreground">{task.excerpt || entry?.item.text}</p>
                                {task.status === "saved" && task.errorItemId && !task.duplicate && task.notebookName && (
                                    <p className="text-xs text-muted-foreground">{t.importTasks.savedTo.replace("{notebook}", task.notebookName).replace("{id}", task.errorItemShortId || "-")}</p>
                                )}
                                {error && task.status === "failed" && <p className="text-xs text-destructive">{error}</p>}
                                <div className="flex flex-wrap gap-2 pt-1">
                                    {task.status === "review" && (
                                        <Button asChild size="sm"><Link href={`/import-tasks/${task.id}`}>{t.importBatch.review}</Link></Button>
                                    )}
                                    {task.status === "saved" && task.errorItemId && (
                                        <Button asChild size="sm" variant="outline"><Link href={`/error-items/${task.errorItemId}`}>{t.importBatch.viewItem}</Link></Button>
                                    )}
                                    {task.status === "failed" && (
                                        <Button type="button" size="sm" variant="outline" onClick={() => onRetryOne(task)} disabled={busy}>
                                            <RotateCcw className="mr-1 h-3 w-3" />{t.importTasks.retry}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
