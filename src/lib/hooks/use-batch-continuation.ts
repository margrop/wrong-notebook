"use client";

import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { getAnalysisErrorMessage } from "@/lib/question/analysis-error";
import { loadImage, renderContinuationPage } from "@/lib/import/batch-crop";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { createImportBatch } from "@/lib/import/import-batch-client";
import type { ImportBatchDetail } from "@/lib/import/import-batch-types";
import { describeImage, ImageDecodeError, prepareImage } from "@/lib/image-pipeline";
import type { BatchDraft, DraftItem } from "@/lib/question-split/draft";
import { removeItem } from "@/lib/question-split/draft-ops";

/** 是否为这道题提供「下一页接着这题」：照片批次中可能被截断的题，以及每页最后一题 */
export function canContinueOnNextPage(item: DraftItem, index: number, total: number): boolean {
    return item.regions.length > 0 && (item.flags.includes("partial") || index === total - 1);
}

/**
 * 照片自动分题的续页：为某道题选择下一页照片后，把这道题在本页的区域放在下一页上方拼成一张图，
 * 新建一个自动分题批次（沿用本批的错题本与卷别）；创建成功后这道题从本批移出（可撤销），避免重复导入。
 */
export function useBatchContinuation(batch: Pick<ImportBatchDetail, "subjectId" | "targetSubjectId" | "paperLevel">, pageUrl: string | null, draft: BatchDraft, onEdit: (change: (draft: BatchDraft) => BatchDraft) => void) {
    const { t, language } = useLanguage();
    const inputRef = useRef<HTMLInputElement>(null);
    const target = useRef<string | null>(null);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    // 本页发起的续页批次（按顺序），用于显示链接
    const [created, setCreated] = useState<string[]>([]);

    /** 为某道题选择下一页照片（手机上由系统提供拍照或相册） */
    const pick = (key: string) => {
        target.current = key;
        inputRef.current?.click();
    };

    const onChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // 清空以便再次选择同一文件也能触发
        event.target.value = "";
        const item = draft.items.find((entry) => entry.key === target.current);
        if (!file || !item || !pageUrl) return;
        setBusyKey(item.key);
        try {
            const prepared = await prepareImage(file);
            try {
                const previous = await loadImage(pageUrl);
                const rendered = await renderContinuationPage(previous, item.regions, prepared);
                const info = { ...describeImage(prepared, rendered), sourceType: "continuation" };
                const next = await createImportBatch({
                    source: "image",
                    imageBase64: rendered.dataUrl,
                    imageInfo: info,
                    language,
                    subjectId: batch.subjectId,
                    targetSubjectId: batch.targetSubjectId,
                    paperLevel: batch.paperLevel,
                });
                onEdit((current) => removeItem(current, item.key));
                setCreated((current) => [...current, next.id]);
                frontendLogger.info("[ImportBatch]", "Continuation batch created", { batchId: next.id, ...info });
                toast.success(t.importBatch.continuation.created);
            } finally {
                prepared.dispose();
            }
        } catch (error) {
            frontendLogger.error("[ImportBatch]", "Continuation failed", { error });
            toast.error(error instanceof ImageDecodeError
                ? t.upload.decodeErrors[error.code].replace("{format}", error.format.toUpperCase())
                : getAnalysisErrorMessage(error, t));
        } finally {
            setBusyKey(null);
        }
    };

    return { pick, busyKey, created, inputProps: { ref: inputRef, onChange: (event: ChangeEvent<HTMLInputElement>) => void onChange(event) } };
}
