"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { getErrorMessage } from "@/lib/error-message";
import type { ImportFileTypeDef } from "@/lib/import/file-read";
import { getFileParser } from "@/lib/import/file-parsers";
import { buildImportSummary } from "@/lib/import/file-import-summary";
import type { FileImportSummary, ImportLanguage } from "@/lib/import/file-import-summary";
import { structuredQuestionsToItemsAsync } from "@/lib/import/structured-to-items";
import {
    MAX_STRUCTURED_ITEMS_TOTAL,
    createStructuredImportBatches,
} from "@/lib/import/structured-batches";
import { createCanvasRenderer, sourceImageFromDataUrl } from "@/lib/import/question-images";
import type { QuestionParseResult } from "@/lib/question-format/types";
import type { Translations } from "@/lib/translations";

export type FileImportPhase =
    | { kind: "pick" }
    | { kind: "parsing"; fileName: string }
    | { kind: "processingImages"; fileName: string; done: number; total: number }
    | { kind: "summary"; fileName: string; fileType: ImportFileTypeDef; result: QuestionParseResult; summary: FileImportSummary }
    | { kind: "creating"; fileName: string; batchCount: number };

export interface UseFileImportOptions {
    /** 界面语言（写入批次） */
    language: ImportLanguage;
    /** 目标错题本（必选，由调用方维护） */
    notebookId: string;
    /** 当前语言的 fileImport 文案组 */
    texts: Translations["fileImport"];
}

export interface UseFileImportResult {
    phase: FileImportPhase;
    handleFile: (file: File, type: ImportFileTypeDef) => Promise<void>;
    handleConfirm: () => Promise<void>;
    handleReset: () => void;
}

/**
 * 「导入题库文件」流程状态：选文件 → 解析 → 图片合成（如有）→ 摘要 → 创建批次并跳转。
 * 只创建 1 个批次时直达批次详情页；多个批次去导入中心列表。
 */
export function useFileImport({ language, notebookId, texts: t }: UseFileImportOptions): UseFileImportResult {
    const router = useRouter();
    const [phase, setPhase] = useState<FileImportPhase>({ kind: "pick" });

    const handleFile = async (file: File, type: ImportFileTypeDef) => {
        const parser = getFileParser(type.key);
        if (!parser) {
            toast.error(t.unsupportedType);
            return;
        }
        setPhase({ kind: "parsing", fileName: file.name });
        let result: QuestionParseResult;
        try {
            const buffer = await file.arrayBuffer();
            result = await parser({ name: file.name, buffer });
        } catch (error) {
            frontendLogger.error("[FileImport]", "Parse file failed", { error: getErrorMessage(error) });
            toast.error(t.parseFailed);
            setPhase({ kind: "pick" });
            return;
        }
        const summary = buildImportSummary(result, language);
        frontendLogger.info("[FileImport]", "File parsed", {
            fileName: file.name,
            type: type.key,
            total: summary.total,
            errors: summary.errorCount,
            warnings: summary.warningCount,
        });
        if (summary.total === 0) {
            // 一题都没解出：直接按错误提示，停留在选择页
            const firstError = summary.errors[0]?.message;
            toast.error(firstError ?? t.noQuestions);
            setPhase({ kind: "pick" });
            return;
        }
        setPhase({ kind: "summary", fileName: file.name, fileType: type, result, summary });
    };

    const handleConfirm = async () => {
        if (phase.kind !== "summary") return;
        if (!notebookId) {
            toast.error(t.notebookRequired);
            return;
        }
        if (phase.summary.total > MAX_STRUCTURED_ITEMS_TOTAL) {
            toast.error(t.tooManyQuestions.replace("{max}", String(MAX_STRUCTURED_ITEMS_TOTAL)));
            return;
        }
        setPhase({ kind: "creating", fileName: phase.fileName, batchCount: Math.ceil(phase.summary.total / 60) });
        // 有图片的题需要先合成压缩；通过 phase 切换显示进度
        const hasImages = phase.result.questions.some((q) => q.images?.length);
        let items;
        try {
            if (hasImages) {
                const renderer = createCanvasRenderer();
                items = await structuredQuestionsToItemsAsync(phase.result.questions, {
                    renderer,
                    decodeFn: sourceImageFromDataUrl,
                    onProgress: (done, total) => {
                        setPhase({ kind: "processingImages", fileName: phase.fileName, done, total });
                    },
                });
            } else {
                items = await structuredQuestionsToItemsAsync(phase.result.questions);
            }
        } catch (error) {
            frontendLogger.error("[FileImport]", "Process images failed", { error: getErrorMessage(error) });
            toast.error(t.parseFailed);
            setPhase({ kind: "summary", fileName: phase.fileName, fileType: phase.fileType, result: phase.result, summary: phase.summary });
            return;
        }
        setPhase({ kind: "creating", fileName: phase.fileName, batchCount: Math.ceil(phase.summary.total / 60) });
        try {
            const { batches, failures } = await createStructuredImportBatches(items, {
                language,
                subjectId: notebookId,
                targetSubjectId: notebookId,
                origin: { fileName: phase.fileName, format: phase.fileType.key },
            });
            if (batches.length > 0) {
                toast.success(t.batchesCreated.replace("{count}", String(batches.length)));
                // 单批直达详情页；多批去导入中心列表
                router.push(batches.length === 1 ? `/import-batches/${batches[0].id}` : "/import-batches");
            }
            for (const failure of failures) {
                toast.error(t.batchFailed.replace("{index}", String(failure.index + 1)).replace("{error}", getErrorMessage(failure.error)));
            }
            if (batches.length === 0 && failures.length > 0) {
                setPhase({ kind: "summary", fileName: phase.fileName, fileType: phase.fileType, result: phase.result, summary: phase.summary });
            }
        } catch (error) {
            frontendLogger.error("[FileImport]", "Create batches failed", { error: getErrorMessage(error) });
            toast.error(getErrorMessage(error));
            setPhase({ kind: "summary", fileName: phase.fileName, fileType: phase.fileType, result: phase.result, summary: phase.summary });
        }
    };

    const handleReset = () => setPhase({ kind: "pick" });

    return { phase, handleFile, handleConfirm, handleReset };
}
