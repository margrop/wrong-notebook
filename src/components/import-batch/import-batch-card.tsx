"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2, Layers, Loader2, PencilLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { formatDateTime } from "@/lib/date-time";
import type { ImportBatchSummary } from "@/lib/import/import-batch-types";
import { cn } from "@/lib/utils";

interface ImportBatchCardProps {
    batch: ImportBatchSummary;
}

const PHASE_ICON = {
    splitting: Loader2,
    processing: Loader2,
    draft: PencilLine,
    attention: AlertCircle,
    failed: AlertCircle,
    done: CheckCircle2,
} as const;

/** 识别任务列表中的一批多题：题数、阶段与各题汇总，点开进入批次页 */
export function ImportBatchCard({ batch }: ImportBatchCardProps) {
    const { t } = useLanguage();
    const { timeZone } = useTimeZone();
    const Icon = PHASE_ICON[batch.phase];
    const active = batch.phase === "splitting" || batch.phase === "processing";
    const count = batch.status === "started" ? batch.counts.total : batch.itemCount;
    const { counts } = batch;
    const parts = batch.status === "started" ? [
        counts.saved > 0 && t.importBatch.counts.saved.replace("{count}", String(counts.saved - counts.duplicate)),
        counts.duplicate > 0 && t.importBatch.counts.duplicate.replace("{count}", String(counts.duplicate)),
        counts.review > 0 && t.importBatch.counts.review.replace("{count}", String(counts.review)),
        counts.failed > 0 && t.importBatch.counts.failed.replace("{count}", String(counts.failed)),
        counts.active > 0 && t.importBatch.counts.active.replace("{count}", String(counts.active)),
    ].filter(Boolean) : [];

    return (
        <div className={cn("space-y-2 rounded-lg border p-3 text-sm", batch.unread && "border-primary/50 bg-primary/5")} data-testid="import-batch-card" data-phase={batch.phase}>
            <div className="flex items-start gap-2">
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", active && "animate-spin text-primary", batch.phase === "done" && "text-green-600", (batch.phase === "failed" || batch.phase === "attention") && "text-destructive")} />
                <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <Layers className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{count > 0 ? t.importBatch.batchOf.replace("{count}", String(count)) : t.importBatch.title}</span>
                        <span className="text-xs text-muted-foreground">{t.importBatch.source[batch.source]} · {t.importBatch.phase[batch.phase]}</span>
                        {batch.unread && <Badge>{t.importTasks.unread}</Badge>}
                    </div>
                    {batch.excerpt && <p className="line-clamp-2 break-words text-muted-foreground">{batch.excerpt}</p>}
                    {parts.length > 0 && <p className="text-xs">{parts.join(" · ")}</p>}
                    <p className="text-xs text-muted-foreground">{t.importTasks.createdAt.replace("{time}", formatDateTime(batch.createdAt, "MM-dd HH:mm", timeZone))}</p>
                </div>
            </div>
            <div className="flex justify-end">
                <Button asChild size="sm" variant={batch.phase === "draft" || batch.phase === "attention" ? "default" : "outline"}>
                    <Link href={`/import-batches/${batch.id}`}>{t.importBatch.open}</Link>
                </Button>
            </div>
        </div>
    );
}
