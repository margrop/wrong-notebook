"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ScanText } from "lucide-react";
import { ImportBatchCard } from "@/components/import-batch/import-batch-card";
import { ImportTaskCard } from "@/components/import-tasks/import-task-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/lib/page-title";
import { IMPORT_TASK_FILTERS, filterImportCenter } from "@/lib/import/import-task-filter";
import type { ImportTaskFilter } from "@/lib/import/import-task-filter";
import { useImportTaskActions } from "@/lib/hooks/use-import-task-actions";
import { useImportTaskList } from "@/lib/hooks/use-import-tasks";
import { useNow } from "@/lib/hooks/use-now";

/** 识别任务列表：执行中、待校对、失败与最近保存的任务；多题批次作为一批显示，不拆成零散任务 */
export default function ImportTasksPage() {
    const { t } = useLanguage();
    usePageTitle(t.importTasks.title);
    const { data, refresh } = useImportTaskList();
    const actions = useImportTaskActions(refresh);
    const now = useNow((data?.activeCount ?? 0) > 0);
    const [filter, setFilter] = useState<ImportTaskFilter>("all");
    const view = useMemo(() => data ? filterImportCenter(data, filter) : null, [data, filter]);

    return (
        <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-8 md:py-8">
            <PageHeader backHref="/" title={t.importTasks.title} description={t.importTasks.description} />
            {!data ? (
                <PageLoading />
            ) : data.tasks.length === 0 && !data.batches?.length ? (
                <EmptyState
                    icon={ScanText}
                    title={t.importTasks.empty}
                    action={<Link href="/"><Button>{t.importTasks.backHome}</Button></Link>}
                />
            ) : (
                <>
                    <div role="group" aria-label={t.importTasks.filter.label} className="flex flex-wrap gap-2">
                        {IMPORT_TASK_FILTERS.map((value) => (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={filter === value}
                                onClick={() => setFilter(value)}
                                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                                    filter === value
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border bg-background hover:bg-muted"
                                }`}
                            >
                                {t.importTasks.filter[value]}
                                <span className="ml-1.5 tabular-nums opacity-80">{view?.counts[value] ?? 0}</span>
                            </button>
                        ))}
                    </div>
                    {view && view.tasks.length === 0 && view.batches.length === 0 ? (
                        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                            {t.importTasks.filter.empty}
                        </p>
                    ) : (
                        <ul className="space-y-3">
                            {[
                                ...(view?.batches ?? []).map((batch) => ({ kind: "batch" as const, createdAt: batch.createdAt, batch })),
                                ...(view?.tasks ?? []).map((task) => ({ kind: "task" as const, createdAt: task.createdAt, task })),
                            ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((entry) => entry.kind === "batch" ? (
                        <li key={`batch-${entry.batch.id}`}>
                            <ImportBatchCard batch={entry.batch} />
                        </li>
                    ) : (
                        <li key={entry.task.id}>
                            <ImportTaskCard
                                task={entry.task}
                                now={now}
                                onReview={() => actions.openReview(entry.task)}
                                onViewItem={() => actions.viewItem(entry.task)}
                                onRetry={() => actions.retry(entry.task)}
                                onDiscard={() => actions.discard(entry.task)}
                            />
                        </li>
                    ))}
                        </ul>
                    )}
                </>
            )}
            <p className="text-xs text-muted-foreground">{t.importTasks.retentionHint}</p>
        </main>
    );
}
