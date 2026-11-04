"use client";

import { AlertCircle, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ImportBatchDetail } from "@/lib/import/import-batch-types";

interface BatchPhasePanelProps {
    batch: ImportBatchDetail;
    busy: boolean;
    onRetry: () => void;
    onDiscard: () => void;
}

/** 分题中与分题失败时的状态卡：分题中可以离开；失败时显示原因，可重新分题或放弃 */
export function BatchPhasePanel({ batch, busy, onRetry, onDiscard }: BatchPhasePanelProps) {
    const { t } = useLanguage();
    const errors = t.errors as Record<string, unknown>;
    const error = batch.error ? (typeof errors[batch.error] === "string" ? errors[batch.error] as string : batch.error) : null;

    if (batch.phase === "splitting") {
        return (
            <section className="flex items-start gap-3 rounded-xl border bg-card p-4" role="status" data-testid="batch-splitting">
                <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
                <div className="min-w-0 flex-1 space-y-2">
                    <p className="font-medium">{t.importBatch.phase.splitting}</p>
                    <p className="text-sm text-muted-foreground">{t.importBatch.splittingHint}</p>
                    <Button type="button" size="sm" variant="ghost" onClick={onDiscard}>{t.importBatch.discard}</Button>
                </div>
            </section>
        );
    }
    return (
        <section className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-card p-4" data-testid="batch-failed">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1 space-y-2">
                <p className="font-medium">{t.importBatch.phase.failed}</p>
                {error && <p className="text-sm text-destructive">{error}</p>}
                {batch.source === "image" && <p className="text-sm text-muted-foreground">{t.importBatch.manualFallback}</p>}
                <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={onRetry} disabled={busy}>
                        <RotateCcw className="mr-1 h-4 w-4" />{t.importBatch.retrySplit}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={onDiscard}>{t.importBatch.discard}</Button>
                </div>
            </div>
        </section>
    );
}
