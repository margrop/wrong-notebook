"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle, Loader2, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { frontendLogger } from "@/lib/frontend-logger";
import { createImportTask, fetchImportTask, markImportTaskRead, retryImportTask } from "@/lib/import/import-task-client";
import type { ImportTaskDetail } from "@/lib/import/import-task-types";
import type { ImportedQuestion } from "@/lib/import/question-import";
import type { BatchImage } from "@/lib/hooks/use-question-import";

interface BatchImportPanelProps {
    /** 已从原图裁剪并压缩好的各题图片 */
    images: BatchImage[];
    /** 指定错题本；为空时按 AI 识别的学科匹配或新建错题本 */
    subjectId?: string | null;
    onClose: () => void;
}

type ItemStatus = "pending" | "uploading" | "analyzing" | "saving" | "success" | "failed";

interface BatchItem {
    status: ItemStatus;
    /** 服务端识别任务；上传后即使离开页面也会继续识别并入库 */
    taskId?: string;
    imported?: ImportedQuestion;
    error?: string;
}

/** 查询任务结果的间隔 */
const POLL_MS = 2500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 等待服务端任务结束（页面在后台时暂停查询，回到前台后继续） */
async function waitForTask(id: string, onStatus: (task: ImportTaskDetail) => void): Promise<ImportTaskDetail> {
    for (;;) {
        if (document.visibilityState !== "hidden") {
            const task = await fetchImportTask(id);
            onStatus(task);
            if (task.status !== "analyzing" && task.status !== "saving") return task;
        }
        await sleep(POLL_MS);
    }
}

// 同时上传的题目数；识别的并发由服务端按「同一模型 AI 并发上限」排队控制
const UPLOAD_CONCURRENCY = 2;

/** 按并发上限依次执行 */
async function runWithConcurrency(indexes: number[], limit: number, run: (index: number) => Promise<void>) {
    const queue = [...indexes];
    const worker = async () => {
        while (queue.length > 0) await run(queue.shift()!);
    };
    await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
}

/**
 * 一图多题：先把所有框上传为服务端识别任务（落库后锁屏或关闭页面也会继续），再等待各题的识别与入库结果。
 */
export function BatchImportPanel({ images, subjectId, onClose }: BatchImportPanelProps) {
    const { t, language } = useLanguage();
    const [items, setItems] = useState<BatchItem[]>(() => images.map(() => ({ status: "pending" })));
    const startedRef = useRef(false);
    const taskIds = useRef<Array<string | undefined>>([]);

    const updateItem = useCallback((index: number, patch: Partial<BatchItem>) => {
        setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    }, []);

    const fail = useCallback((index: number, error: unknown) => {
        const data = (error as { data?: { message?: string } })?.data;
        const backendError = data?.message || (error instanceof Error ? error.message : String(error));
        const mapped = (t.errors as Record<string, unknown>)[backendError];
        updateItem(index, { status: "failed", error: typeof mapped === "string" ? mapped : backendError });
        frontendLogger.error('[BatchImport]', 'Question import failed', { index, error: backendError });
    }, [t.errors, updateItem]);

    /** 第一步：上传并创建任务（已上传过的改为重试服务端任务）；返回是否已落库 */
    const submit = useCallback(async (index: number): Promise<boolean> => {
        updateItem(index, { status: "uploading", error: undefined });
        try {
            const existing = taskIds.current[index];
            if (existing) {
                // 已上传过：重试服务端任务（有识别结果时只重试保存，不重新识别）
                await retryImportTask(existing);
            } else {
                const image = images[index];
                const task = await createImportTask({
                    imageBase64: image.dataUrl,
                    language,
                    subjectId,
                    targetSubjectId: subjectId,
                    mode: "auto",
                    clientTimings: image.timings,
                    imageInfo: image.info,
                });
                taskIds.current[index] = task.id;
                updateItem(index, { taskId: task.id });
            }
            updateItem(index, { status: "analyzing" });
            return true;
        } catch (error) {
            fail(index, error);
            return false;
        }
    }, [images, language, subjectId, updateItem, fail]);

    /** 第二步：等待服务端识别与入库结果 */
    const watch = useCallback(async (index: number) => {
        const taskId = taskIds.current[index];
        if (!taskId) return;
        try {
            const task = await waitForTask(taskId, (current) => updateItem(index, { status: current.status === "saving" ? "saving" : "analyzing" }));
            if (task.status !== "saved" || !task.errorItemId) throw { data: { message: task.error || "QUESTION_SAVE_FAILED" } };
            markImportTaskRead(taskId).catch(() => undefined);
            updateItem(index, {
                status: "success",
                imported: { id: task.errorItemId, shortId: task.errorItemShortId, subjectId: subjectId ?? null, notebookName: task.notebookName, duplicate: task.duplicate },
            });
        } catch (error) {
            fail(index, error);
        }
    }, [subjectId, updateItem, fail]);

    const runAll = useCallback(async (indexes: number[]) => {
        const submitted: number[] = [];
        await runWithConcurrency(indexes, UPLOAD_CONCURRENCY, async (index) => {
            if (await submit(index)) submitted.push(index);
        });
        await Promise.all(submitted.map(watch));
    }, [submit, watch]);

    const runOne = useCallback(async (index: number) => {
        if (await submit(index)) await watch(index);
    }, [submit, watch]);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        runAll(images.map((_, index) => index));
    }, [images, runAll]);

    const done = items.filter((item) => item.status === "success").length;
    const failedIndexes = items.flatMap((item, index) => (item.status === "failed" ? [index] : []));
    const running = items.some((item) => item.status === "pending" || item.status === "uploading" || item.status === "analyzing" || item.status === "saving");
    // 全部上传后即可离开：识别与入库在服务端继续，结果在「识别任务」中查看
    const uploading = items.some((item) => item.status === "pending" || item.status === "uploading");
    const uploadedCount = items.filter((item) => item.taskId && item.status !== "uploading").length;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base">{t.batchImport.title}</CardTitle>
                <span className="text-sm text-muted-foreground">
                    {t.batchImport.summary
                        .replace("{done}", String(done))
                        .replace("{total}", String(items.length))
                        .replace("{failed}", String(failedIndexes.length))}
                </span>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground" data-testid="batch-upload-progress">
                    {uploading
                        ? t.batchImport.uploaded.replace("{done}", String(uploadedCount)).replace("{total}", String(items.length))
                        : running ? t.importTasks.uploadedHint : null}
                </p>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((item, index) => (
                        <li key={index} className="flex gap-3 rounded-lg border p-3">
                            <img src={images[index].dataUrl} alt="" className="h-20 w-20 shrink-0 rounded object-contain bg-muted" />
                            <div className="min-w-0 flex-1 space-y-1 text-sm">
                                <div className="font-medium">{t.batchImport.question.replace("{index}", String(index + 1))}</div>
                                <StatusLine item={item} />
                                {item.status === "success" && item.imported && (
                                    <Link href={`/error-items/${item.imported.id}`} className="block truncate text-xs text-primary hover:underline">
                                        {item.imported.notebookName} · {item.imported.shortId}
                                    </Link>
                                )}
                                {item.status === "failed" && (
                                    <>
                                        {item.error && <p className="line-clamp-2 text-xs text-destructive">{item.error}</p>}
                                        <Button size="sm" variant="outline" className="h-7" onClick={() => runOne(index)}>
                                            <RotateCcw className="mr-1 h-3 w-3" />
                                            {t.batchImport.retry}
                                        </Button>
                                    </>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                    {failedIndexes.length > 1 && !running && (
                        <Button variant="outline" onClick={() => runAll(failedIndexes)}>
                            <RotateCcw className="mr-2 h-4 w-4" />
                            {t.batchImport.retryFailed}
                        </Button>
                    )}
                    <Button onClick={onClose} disabled={uploading}>
                        {t.batchImport.finish}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function StatusLine({ item }: { item: BatchItem }) {
    const { t } = useLanguage();
    const label = t.batchImport.status[item.status];
    if (item.status === "success") {
        return <span className="flex items-start gap-1 text-green-700 dark:text-green-300"><CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />{item.imported?.duplicate ? t.importFlow.duplicate : label}</span>;
    }
    if (item.status === "failed") {
        return <span className="flex items-center gap-1 text-destructive"><XCircle className="h-4 w-4" />{label}</span>;
    }
    return (
        <span className="flex items-center gap-1 text-muted-foreground">
            {item.status !== "pending" && <Loader2 className="h-4 w-4 animate-spin" />}
            {label}
        </span>
    );
}
