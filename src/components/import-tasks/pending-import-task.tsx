"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { ImportTaskCard } from "@/components/import-tasks/import-task-card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ImportTaskSummary } from "@/lib/import/import-task-types";
import { useImportTaskActions } from "@/lib/hooks/use-import-task-actions";
import { useNow } from "@/lib/hooks/use-now";

interface PendingImportTaskProps {
    task: ImportTaskSummary;
    onRefresh: () => void;
    onDismiss: () => void;
}

/** 上传后在页面内显示的任务状态（不遮挡页面），提示可以离开 */
export function PendingImportTask({ task, onRefresh, onDismiss }: PendingImportTaskProps) {
    const { t } = useLanguage();
    const actions = useImportTaskActions(onRefresh);
    const now = useNow(task.status === "analyzing" || task.status === "saving");

    return (
        <div className="space-y-2 rounded-xl border bg-card p-3" role="status" data-testid="pending-import-task">
            <div className="flex items-start gap-2">
                <p className="flex-1 text-sm text-muted-foreground">{t.importTasks.uploadedHint}</p>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onDismiss} aria-label={t.common.close}>
                    <X className="h-4 w-4" />
                </Button>
            </div>
            <ImportTaskCard
                task={task}
                now={now}
                onReview={() => actions.openReview(task)}
                onViewItem={() => actions.viewItem(task)}
                onRetry={() => actions.retry(task)}
                onDiscard={async () => {
                    if (await actions.discard(task)) onDismiss();
                }}
            />
            <p className="text-xs text-muted-foreground">
                {t.importTasks.stageEstimate} ·{" "}
                <Link href="/import-tasks" className="text-primary hover:underline">{t.importTasks.viewTasks}</Link>
            </p>
        </div>
    );
}
