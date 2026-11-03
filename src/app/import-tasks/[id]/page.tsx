"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ScanText } from "lucide-react";
import { CorrectionEditor } from "@/components/correction-editor";
import { ImportTaskCard } from "@/components/import-tasks/import-task-card";
import { QuestionSaveError } from "@/components/question-save-error";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ReviewedQuestion } from "@/lib/use-question-import";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { confirmImportTask } from "@/lib/import-task-client";
import { usePageTitle } from "@/lib/page-title";
import { useImportTaskActions } from "@/lib/use-import-task-actions";
import { useImportTask } from "@/lib/use-import-tasks";
import { useNow } from "@/lib/use-now";
import { useQuestionSaver } from "@/lib/use-question-saver";
import type { Notebook } from "@/types/api";

/** 单个识别任务：待校对时显示校对页，其余状态显示进度与可用操作。刷新或换设备打开都取回同一结果。 */
export default function ImportTaskPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;
    const { t } = useLanguage();
    usePageTitle(t.importTasks.title);
    const { task, notFound, refresh } = useImportTask(id);
    const actions = useImportTaskActions(refresh);
    const saver = useQuestionSaver('[ImportTask]');
    const now = useNow(task?.status === "analyzing" || task?.status === "saving");
    // 记录已标记已读的任务编号，切换到另一个任务时重新标记
    const markedRead = useRef<string | null>(null);
    // 未指定错题本时与首页一致：按识别出的学科自动选择名称相近的错题本
    const [notebooks, setNotebooks] = useState<Notebook[] | null>(null);
    useEffect(() => {
        apiClient.get<Notebook[]>("/api/notebooks")
            .then(setNotebooks)
            .catch((error: unknown) => {
                frontendLogger.error('[ImportTask]', 'Failed to fetch notebooks', { error });
                setNotebooks([]);
            });
    }, []);

    // 打开结果即视为已查看
    useEffect(() => {
        if (!task || markedRead.current === task.id || !task.unread) return;
        markedRead.current = task.id;
        actions.markRead(task);
    }, [task, actions]);

    if (notFound) {
        return (
            <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
                <EmptyState
                    icon={ScanText}
                    title={t.importTasks.notFound}
                    action={<Link href="/import-tasks"><Button>{t.importTasks.viewTasks}</Button></Link>}
                />
            </main>
        );
    }
    if (!task || (task.status === "review" && !notebooks)) return <PageLoading />;
    const subject = task.result?.subject;
    const matchedNotebook = subject ? notebooks?.find((notebook) => notebook.name.includes(subject) || subject.includes(notebook.name)) : undefined;

    const save = async (data: ReviewedQuestion) => {
        const subjectId = task.targetSubjectId ?? data.subjectId ?? null;
        const saved = await saver.run(() => confirmImportTask(task.id, { ...data, subjectId }), subjectId);
        if (saved && !subjectId) router.push("/import-tasks");
        if (!saved) refresh();
    };

    return (
        <main className={`mx-auto space-y-4 px-4 py-6 md:px-8 md:py-8 ${task.status === "review" ? "max-w-6xl" : "max-w-3xl"}`}>
            <PageHeader backHref="/import-tasks" title={t.importTasks.title} description={t.importTasks.status[task.status]} />
            <QuestionSaveError message={saver.saveError} onDismiss={saver.dismissSaveError} />
            {task.status === "review" && task.result ? (
                <CorrectionEditor
                    initialData={task.result}
                    imagePreview={task.imageData}
                    onSave={save}
                    onCancel={() => router.push("/import-tasks")}
                    initialSubjectId={task.targetSubjectId || task.subjectId || matchedNotebook?.id}
                />
            ) : (
                <ImportTaskCard
                    task={task}
                    now={now}
                    onViewItem={() => actions.viewItem(task)}
                    onRetry={() => actions.retry(task)}
                    onDiscard={async () => {
                        if (await actions.discard(task)) router.push("/import-tasks");
                    }}
                />
            )}
        </main>
    );
}
