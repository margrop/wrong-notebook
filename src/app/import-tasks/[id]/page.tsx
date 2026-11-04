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
import type { ReviewedQuestion } from "@/lib/hooks/use-question-import";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { confirmImportTask, fetchImportTask } from "@/lib/import/import-task-client";
import { usePageTitle } from "@/lib/page-title";
import { useImportTaskActions } from "@/lib/hooks/use-import-task-actions";
import { useImportTask } from "@/lib/hooks/use-import-tasks";
import { useNow } from "@/lib/hooks/use-now";
import { useQuestionSaver } from "@/lib/hooks/use-question-saver";
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
    // 状态轮询不带图片；进入待校对时单独取一次题目图片
    const [image, setImage] = useState<{ id: string; data: string | null } | null>(null);
    const reviewing = task?.status === "review";
    useEffect(() => {
        if (!reviewing) return;
        let cancelled = false;
        fetchImportTask(id, { image: true })
            .then((detail) => {
                if (!cancelled) setImage({ id, data: detail.imageData });
            })
            .catch((error: unknown) => frontendLogger.error('[ImportTask]', 'Failed to load task image', { error }));
        return () => {
            cancelled = true;
        };
    }, [id, reviewing]);
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
    if (!task || (task.status === "review" && (!notebooks || image?.id !== id))) return <PageLoading />;
    const subject = task.result?.subject;
    const matchedNotebook = subject ? notebooks?.find((notebook) => notebook.name.includes(subject) || subject.includes(notebook.name)) : undefined;

    // 批次中的题：校对完成或返回时回到本批题目
    const backHref = task.batchId ? `/import-batches/${task.batchId}` : "/import-tasks";
    const save = async (data: ReviewedQuestion) => {
        const subjectId = task.targetSubjectId ?? data.subjectId ?? null;
        const saved = await saver.run(() => confirmImportTask(task.id, { ...data, subjectId }), subjectId, !task.batchId);
        if (saved && (task.batchId || !subjectId)) router.push(backHref);
        if (!saved) refresh();
    };

    return (
        <main className={`mx-auto space-y-4 px-4 py-6 md:px-8 md:py-8 ${task.status === "review" ? "max-w-6xl" : "max-w-3xl"}`}>
            <PageHeader backHref={backHref} title={task.batchId ? t.importBatch.title : t.importTasks.title} description={t.importTasks.status[task.status]} />
            <QuestionSaveError message={saver.saveError} onDismiss={saver.dismissSaveError} />
            {task.status === "review" && task.result ? (
                <CorrectionEditor
                    initialData={task.result}
                    imagePreview={image?.data ?? null}
                    onSave={save}
                    onCancel={() => router.push(backHref)}
                    initialSubjectId={task.targetSubjectId || task.subjectId || matchedNotebook?.id}
                />
            ) : (
                <ImportTaskCard
                    task={task}
                    now={now}
                    onViewItem={() => actions.viewItem(task)}
                    onRetry={() => actions.retry(task)}
                    onDiscard={async () => {
                        if (await actions.discard(task)) router.push(backHref);
                    }}
                />
            )}
        </main>
    );
}
