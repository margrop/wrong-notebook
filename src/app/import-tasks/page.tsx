"use client";

import Link from "next/link";
import { ScanText } from "lucide-react";
import { ImportTaskCard } from "@/components/import-tasks/import-task-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/lib/page-title";
import { useImportTaskActions } from "@/lib/use-import-task-actions";
import { useImportTaskList } from "@/lib/use-import-tasks";
import { useNow } from "@/lib/use-now";

/** 识别任务列表：执行中、待校对、失败与最近保存的任务 */
export default function ImportTasksPage() {
    const { t } = useLanguage();
    usePageTitle(t.importTasks.title);
    const { data, refresh } = useImportTaskList();
    const actions = useImportTaskActions(refresh);
    const now = useNow((data?.activeCount ?? 0) > 0);

    return (
        <main className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-8 md:py-8">
            <PageHeader backHref="/" title={t.importTasks.title} description={t.importTasks.description} />
            {!data ? (
                <PageLoading />
            ) : data.tasks.length === 0 ? (
                <EmptyState
                    icon={ScanText}
                    title={t.importTasks.empty}
                    action={<Link href="/"><Button>{t.importTasks.backHome}</Button></Link>}
                />
            ) : (
                <ul className="space-y-3">
                    {data.tasks.map((task) => (
                        <li key={task.id}>
                            <ImportTaskCard
                                task={task}
                                now={now}
                                onReview={() => actions.openReview(task)}
                                onViewItem={() => actions.viewItem(task)}
                                onRetry={() => actions.retry(task)}
                                onDiscard={() => actions.discard(task)}
                            />
                        </li>
                    ))}
                </ul>
            )}
            <p className="text-xs text-muted-foreground">{t.importTasks.retentionHint}</p>
        </main>
    );
}
