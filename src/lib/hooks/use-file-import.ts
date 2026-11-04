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
import { loadPdfjsBrowser } from "@/lib/import/file-parsers/pdf/load-pdfjs";
import { renderPdfPages } from "@/lib/import/file-parsers/pdf/render-pages";
import type { PdfDocumentProxyLike, RenderedPdfPage } from "@/lib/import/file-parsers/pdf/render-pages";
import {
    createScannedPdfBatches,
    isQuotaError,
} from "@/lib/import/scanned-pdf-flow";
import type { QuestionParseResult } from "@/lib/question-format/types";
import type { Translations } from "@/lib/translations";

export type FileImportPhase =
    | { kind: "pick" }
    | { kind: "parsing"; fileName: string }
    | { kind: "processingImages"; fileName: string; done: number; total: number }
    | { kind: "summary"; fileName: string; fileType: ImportFileTypeDef; result: QuestionParseResult; summary: FileImportSummary }
    | { kind: "creating"; fileName: string; batchCount: number }
    | { kind: "scanned-pdf"; fileName: string; buffer: ArrayBuffer; pageCount: number }
    | { kind: "rendering-pdf"; fileName: string; rendered: number; total: number }
    | { kind: "creating-pdf-batches"; fileName: string; created: number; total: number };

export interface UseFileImportOptions {
    /** 界面语言（写入批次） */
    language: ImportLanguage;
    /** 目标错题本（必选，由调用方维护） */
    notebookId: string;
    /** 当前语言的 fileImport 文案组 */
    texts: Translations["fileImport"];
    /**
     * 依赖注入（测试用）：渲染 PDF 页与创建批次的实现。
     * 默认分别使用 pdfjs 渲染与 createScannedPdfBatches。
     */
    scannedPdfDeps?: {
        renderPages?: (buffer: ArrayBuffer, pages: number[], onProgress: (done: number, total: number) => void) => Promise<RenderedPdfPage[]>;
        createBatches?: typeof createScannedPdfBatches;
    };
}

export interface UseFileImportResult {
    phase: FileImportPhase;
    handleFile: (file: File, type: ImportFileTypeDef) => Promise<void>;
    handleConfirm: () => Promise<void>;
    handleReset: () => void;
    /** 扫描版 PDF：确认页码范围后触发渲染与建批次 */
    handleScannedPdfConfirm: (pages: number[]) => Promise<void>;
}

/** 从 PAGES:N 警告中取总页数 */
export function scannedPdfPageCount(result: QuestionParseResult): number | null {
    for (const warning of result.warnings) {
        if (warning.startsWith("PAGES:")) {
            const count = Number.parseInt(warning.slice("PAGES:".length), 10);
            return Number.isFinite(count) ? count : null;
        }
    }
    return null;
}

/**
 * 「导入题库文件」流程状态：选文件 → 解析 → 图片合成（如有）→ 摘要 → 创建批次并跳转。
 * 只创建 1 个批次时直达批次详情页；多个批次去导入中心列表。
 * 扫描版 PDF（PDF_NO_TEXT_LAYER）提供页码范围选择，转图片后逐页创建 image 批次。
 */
export function useFileImport({ language, notebookId, texts: t, scannedPdfDeps }: UseFileImportOptions): UseFileImportResult {
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
        let buffer: ArrayBuffer;
        try {
            buffer = await file.arrayBuffer();
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
            // 扫描版 PDF：不走「无法导入」死路，提供转图片识别分题的入口
            if (type.key === "pdf" && result.errors.some((error) => error.reason === "PDF_NO_TEXT_LAYER")) {
                const pageCount = scannedPdfPageCount(result) ?? 0;
                setPhase({ kind: "scanned-pdf", fileName: file.name, buffer, pageCount });
                return;
            }
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

    /** 扫描版 PDF：渲染指定页 → 每页创建 image 批次 → 跳转导入中心 */
    const handleScannedPdfConfirm = async (pages: number[]) => {
        if (phase.kind !== "scanned-pdf") return;
        if (!notebookId) {
            toast.error(t.notebookRequired);
            return;
        }
        const { fileName, buffer } = phase;
        setPhase({ kind: "rendering-pdf", fileName, rendered: 0, total: pages.length });
        let renderedPages: RenderedPdfPage[];
        try {
            renderedPages = scannedPdfDeps?.renderPages
                ? await scannedPdfDeps.renderPages(buffer, pages, (done, total) => {
                    setPhase({ kind: "rendering-pdf", fileName, rendered: done, total });
                })
                : await defaultRenderPages(buffer, pages, (done, total) => {
                    setPhase({ kind: "rendering-pdf", fileName, rendered: done, total });
                });
        } catch (error) {
            frontendLogger.error("[FileImport]", "Render scanned PDF failed", { error: getErrorMessage(error) });
            toast.error(t.pdfRenderFailed);
            setPhase({ kind: "scanned-pdf", fileName, buffer, pageCount: phase.pageCount });
            return;
        }

        setPhase({ kind: "creating-pdf-batches", fileName, created: 0, total: renderedPages.length });
        const createBatches = scannedPdfDeps?.createBatches ?? createScannedPdfBatches;
        const { successes, failures } = await createBatches(
            renderedPages,
            { language, notebookId },
            {
                onProgress: (done, total) => {
                    setPhase({ kind: "creating-pdf-batches", fileName, created: done, total });
                },
            },
        );

        for (const failure of failures) {
            if (isQuotaError(failure.error)) {
                toast.error(t.pdfQuotaExceeded.replace("{page}", String(failure.pageNumber)));
            } else {
                toast.error(t.pdfPageFailed.replace("{page}", String(failure.pageNumber)).replace("{error}", getErrorMessage(failure.error)));
            }
        }

        if (successes.length > 0) {
            toast.success(t.batchesCreated.replace("{count}", String(successes.length)));
            // 单批直达详情页；多批去导入中心列表
            router.push(successes.length === 1 ? `/import-batches/${successes[0].batch.id}` : "/import-batches");
        } else {
            // 全部失败：回到扫描版选择页，可调整范围重试
            setPhase({ kind: "scanned-pdf", fileName, buffer, pageCount: phase.pageCount });
        }
    };

    const handleReset = () => setPhase({ kind: "pick" });

    return { phase, handleFile, handleConfirm, handleReset, handleScannedPdfConfirm };
}

/** 默认渲染实现：用 pdfjs 打开 buffer 并逐页渲染 */
async function defaultRenderPages(
    buffer: ArrayBuffer,
    pages: number[],
    onProgress: (done: number, total: number) => void,
): Promise<RenderedPdfPage[]> {
    const pdfjs = await loadPdfjsBrowser();
    const doc = (await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise) as unknown as PdfDocumentProxyLike;
    return renderPdfPages(doc, { pages, onProgress });
}
