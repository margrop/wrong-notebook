"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { BatchDraftEditor } from "@/components/import-batch/batch-draft-editor";
import { BatchPhasePanel } from "@/components/import-batch/batch-phase-panel";
import { BatchProgress } from "@/components/import-batch/batch-progress";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { useLanguage } from "@/contexts/LanguageContext";
import { getAnalysisErrorMessage } from "@/lib/question/analysis-error";
import { loadImage, renderQuestionImage } from "@/lib/import/batch-crop";
import { confirmDialog, toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { confirmAllImportBatch, conflictBatch, discardImportBatch, markImportBatchRead, retryImportBatch, startImportBatch } from "@/lib/import/import-batch-client";
import { MAX_START_IMAGES_LENGTH } from "@/lib/import/import-batch-types";
import type { BatchItemImage } from "@/lib/import/import-batch-client";
import { retryImportTask } from "@/lib/import/import-task-client";
import type { ImportTaskSummary } from "@/lib/import/import-task-types";
import { usePageTitle } from "@/lib/page-title";
import { fetchConfirmBeforeImport } from "@/lib/import/question-import";
import { readyItems } from "@/lib/question-split/draft";
import { useImportBatch } from "@/lib/hooks/use-import-batch";
import { usePageImage } from "@/lib/hooks/use-page-image";

/**
 * 多题批次页：分题中 → 预览与调整 → 开始后的统一进度。刷新、锁屏、换设备打开都从服务端取回同一批次；
 * 后台完成只更新本页内容，不会切走正在编辑的内容。
 */
export default function ImportBatchPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;
    const { t } = useLanguage();
    usePageTitle(t.importBatch.title);
    const batchState = useImportBatch(id, { onConflict: () => toast.info(t.importBatch.conflict) });
    const { batch, draft, notFound } = batchState;
    const image = usePageImage(batch?.source === "image" ? batch.imageData : null);
    const [confirmBeforeImport, setConfirmBeforeImport] = useState<boolean | null>(null);
    const [starting, setStarting] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const markedRead = useRef<string | null>(null);

    useEffect(() => {
        fetchConfirmBeforeImport().then(setConfirmBeforeImport);
    }, []);

    // 打开即视为已查看
    useEffect(() => {
        if (!batch?.unread || markedRead.current === `${batch.id}:${batch.phase}:${batch.counts.active}`) return;
        markedRead.current = `${batch.id}:${batch.phase}:${batch.counts.active}`;
        markImportBatchRead(batch.id).catch((error: unknown) => frontendLogger.warn('[ImportBatch]', 'Mark read failed', { error }));
    }, [batch]);

    if (notFound) {
        return (
            <main className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
                <EmptyState icon={Layers} title={t.importBatch.notFound} action={<Link href="/import-tasks"><Button>{t.importTasks.viewTasks}</Button></Link>} />
            </main>
        );
    }
    if (!batch || confirmBeforeImport === null || (batch.source === "image" && batch.status === "draft" && !image)) return <PageLoading />;

    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        try {
            await action();
        } catch (error) {
            const latest = conflictBatch(error);
            if (latest) {
                batchState.replace(latest);
                toast.info(t.importBatch.conflict);
            } else {
                toast.error(getAnalysisErrorMessage(error, t));
            }
        } finally {
            setBusy(false);
        }
    };

    const start = async () => {
        if (!draft) return;
        setStarting(t.importBatch.submitting);
        try {
            if (!await batchState.save()) return;
            let images: BatchItemImage[] | undefined;
            if (batch.source === "image") {
                if (!batch.imageData) throw new Error("IMAGE_EMPTY");
                const page = await loadImage(batch.imageData);
                const ready = readyItems(draft, "image");
                images = [];
                let bytes = 0;
                for (const item of ready) {
                    setStarting(t.importBatch.cropping.replace("{done}", String(images.length + 1)).replace("{total}", String(ready.length)));
                    const rendered = await renderQuestionImage(page, item.regions);
                    bytes += rendered.bytes;
                    images.push({ key: item.key, imageBase64: rendered.dataUrl, imageInfo: { outputWidth: rendered.width, outputHeight: rendered.height, outputBytes: rendered.bytes, quality: rendered.quality } });
                }
                // 与服务端相同的总量上限：超出时不提交，批次保持待确认
                if (images.reduce((sum, image) => sum + image.imageBase64.length, 0) > MAX_START_IMAGES_LENGTH) {
                    toast.error(t.errors.IMPORT_BATCH_TOO_LARGE);
                    return;
                }
                setStarting(t.importBatch.uploadingImages.replace("{count}", String(images.length)).replace("{size}", `${(bytes / 1024 / 1024).toFixed(1)}MB`));
            }
            batchState.replace(await startImportBatch(batch.id, batchState.version(), images));
            window.scrollTo({ top: 0 });
        } catch (error) {
            frontendLogger.error('[ImportBatch]', 'Start failed', { error });
            const latest = conflictBatch(error);
            if (latest) {
                batchState.replace(latest);
                toast.info(t.importBatch.conflict);
            } else {
                toast.error(getAnalysisErrorMessage(error, t));
            }
        } finally {
            setStarting(null);
        }
    };

    const discard = async () => {
        if (!await confirmDialog(t.importBatch.discardConfirm)) return;
        await run(async () => {
            await discardImportBatch(batch.id);
            toast.success(t.importBatch.discarded);
            router.push("/import-tasks");
        });
    };

    const retry = () => run(async () => {
        batchState.replace(await retryImportBatch(batch.id));
        toast.info(t.importTasks.retried);
    });

    const retryOne = (task: ImportTaskSummary) => run(async () => {
        await retryImportTask(task.id);
        toast.info(t.importTasks.retried);
        await batchState.refresh();
    });

    const confirmAll = () => run(async () => {
        const result = await confirmAllImportBatch(batch.id);
        batchState.replace(result.batch);
        toast.success(t.importBatch.confirmAllDone.replace("{count}", String(result.saved)));
    });

    const description = `${t.importBatch.source[batch.source]} · ${t.importBatch.phase[batch.phase]}`;

    return (
        <main className="mx-auto max-w-4xl space-y-4 px-4 py-6 md:px-8 md:py-8">
            <PageHeader backHref="/import-tasks" title={t.importBatch.title} description={description} />
            {batch.phase === "splitting" || batch.phase === "failed" ? (
                <BatchPhasePanel batch={batch} busy={busy} onRetry={retry} onDiscard={discard} />
            ) : batch.status === "draft" && draft ? (
                <BatchDraftEditor
                    batch={batch}
                    draft={draft}
                    onEdit={batchState.edit}
                    onUndo={batchState.undo}
                    canUndo={batchState.canUndo}
                    saveState={batchState.saveState}
                    image={image}
                    confirmBeforeImport={confirmBeforeImport}
                    starting={starting}
                    onStart={start}
                    onDiscard={discard}
                    hasConflictCopy={!!batchState.conflictCopy}
                    onRestoreConflict={batchState.restoreConflictCopy}
                    onDismissConflict={batchState.dismissConflictCopy}
                />
            ) : (
                <BatchProgress batch={batch} image={image} busy={busy} onRetryFailed={retry} onRetryOne={retryOne} onConfirmAll={confirmAll} />
            )}
        </main>
    );
}
