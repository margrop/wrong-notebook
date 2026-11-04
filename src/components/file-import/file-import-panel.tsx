"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText, FileWarning, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ImportFileButton } from "@/components/import-file-button";
import { NotebookSelector } from "@/components/notebook-selector";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { getErrorMessage } from "@/lib/error-message";
import { BANK_FILE_TYPES } from "@/lib/import/file-read";
import type { ImportFileTypeDef } from "@/lib/import/file-read";
import type { FileImportSummary } from "@/lib/import/file-import-summary";
import { buildCsvTemplate, buildXlsxTemplate } from "@/lib/import/file-parsers/table-template";
import { MAX_SCAN_PAGES_PER_IMPORT, parsePageRanges } from "@/lib/import/file-parsers/pdf/render-pages";
import { useFileImport } from "@/lib/hooks/use-file-import";
import type { FileImportPhase } from "@/lib/hooks/use-file-import";

/** 触发浏览器下载 */
function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}

export interface FileImportPanelProps {
    /** 默认选中的错题本（首页 ?notebook= 参数） */
    defaultNotebookId?: string;
}

/**
 * 「导入题库文件」面板：选择文件 → 解析 → 摘要（题数/错误/警告/未导入字段）
 * → 选择目标错题本 → 创建批次并跳转导入中心（单批直达详情页）。
 */
export function FileImportPanel({ defaultNotebookId }: FileImportPanelProps) {
    const { t, language } = useLanguage();
    const [notebookId, setNotebookId] = useState(defaultNotebookId ?? "");
    const lang = language === "en" ? "en" : "zh";
    const { phase, handleFile, handleConfirm, handleReset, handleScannedPdfConfirm } = useFileImport({
        language: lang,
        notebookId,
        texts: t.fileImport,
    });

    return (
        <Card className="rounded-2xl" data-testid="file-import-panel">
            <CardContent className="space-y-4 p-6">
                <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                    <FileText className="h-5 w-5" />
                    <span className="text-sm font-medium">{t.fileImport.title}</span>
                </div>
                <FileImportPhaseView
                    phase={phase}
                    notebookId={notebookId}
                    onNotebookChange={setNotebookId}
                    onFile={handleFile}
                    onConfirm={handleConfirm}
                    onReset={handleReset}
                    onScannedPdfConfirm={handleScannedPdfConfirm}
                />
            </CardContent>
        </Card>
    );
}

interface FileImportPhaseViewProps {
    phase: FileImportPhase;
    notebookId: string;
    onNotebookChange: (value: string) => void;
    onFile: (file: File, type: ImportFileTypeDef) => Promise<void>;
    onConfirm: () => Promise<void>;
    onReset: () => void;
    onScannedPdfConfirm: (pages: number[]) => Promise<void>;
}

/** 按流程阶段渲染：选择 → 解析中 → 图片处理中 → 摘要 → 创建中 → 扫描版 PDF → 渲染/建批进度 */
function FileImportPhaseView({ phase, notebookId, onNotebookChange, onFile, onConfirm, onReset, onScannedPdfConfirm }: FileImportPhaseViewProps) {
    switch (phase.kind) {
        case "parsing":
            return <FileImportBusy textKey="parsing" fileName={phase.fileName} />;
        case "processingImages":
            return <FileImportImageProcessing fileName={phase.fileName} done={phase.done} total={phase.total} />;
        case "creating":
            return <FileImportBusy textKey="creating" batchCount={phase.batchCount} />;
        case "rendering-pdf":
            return <FileImportBusy textKey="rendering-pdf" rendered={phase.rendered} total={phase.total} />;
        case "creating-pdf-batches":
            return <FileImportBusy textKey="creating-pdf-batches" rendered={phase.created} total={phase.total} />;
        case "scanned-pdf":
            return (
                <ScannedPdfView
                    fileName={phase.fileName}
                    pageCount={phase.pageCount}
                    notebookId={notebookId}
                    onNotebookChange={onNotebookChange}
                    onConfirm={onScannedPdfConfirm}
                    onReset={onReset}
                />
            );
        case "summary":
            return (
                <FileImportSummaryView
                    fileName={phase.fileName}
                    summary={phase.summary}
                    notebookId={notebookId}
                    onNotebookChange={onNotebookChange}
                    onConfirm={onConfirm}
                    onReset={onReset}
                />
            );
        default:
            return <FileImportPickView onFile={onFile} />;
    }
}

/** 图片处理进度（合成与压缩题目图片） */
function FileImportImageProcessing({ fileName, done, total }: { fileName: string; done: number; total: number }) {
    const { t } = useLanguage();
    return (
        <div className="flex flex-col items-center gap-3 py-10 text-center" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
                {t.fileImport.processingImages.replace("{name}", fileName).replace("{done}", String(done)).replace("{total}", String(total))}
            </p>
        </div>
    );
}

/** 进行中状态（解析 / 创建批次 / PDF 渲染与建批进度） */
function FileImportBusy({ textKey, fileName, batchCount, rendered, total }: {
    textKey: "parsing" | "creating" | "rendering-pdf" | "creating-pdf-batches";
    fileName?: string;
    batchCount?: number;
    rendered?: number;
    total?: number;
}) {
    const { t } = useLanguage();
    let text: string;
    if (textKey === "parsing") {
        text = t.fileImport.parsing.replace("{name}", fileName ?? "");
    } else if (textKey === "creating") {
        text = t.fileImport.creating.replace("{count}", String(batchCount ?? 0));
    } else if (textKey === "rendering-pdf") {
        text = t.fileImport.pdfRendering.replace("{done}", String(rendered ?? 0)).replace("{total}", String(total ?? 0));
    } else {
        text = t.fileImport.pdfCreatingBatches.replace("{done}", String(rendered ?? 0)).replace("{total}", String(total ?? 0));
    }
    return (
        <div className="flex flex-col items-center gap-3 py-10 text-center" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{text}</p>
        </div>
    );
}

/** 选择文件视图：上传区与 Excel / CSV 模板下载 */
function FileImportPickView({ onFile }: { onFile: (file: File, type: ImportFileTypeDef) => Promise<void> }) {
    const { t } = useLanguage();
    const formatList = BANK_FILE_TYPES.map((type) => type.extensions.join(" / ")).join("、");

    const handleDownloadCsvTemplate = () => {
        const blob = new Blob([buildCsvTemplate()], { type: "text/csv;charset=utf-8" });
        downloadBlob(blob, "question-template.csv");
    };

    const handleDownloadXlsxTemplate = async () => {
        try {
            const blob = await buildXlsxTemplate();
            downloadBlob(blob, "question-template.xlsx");
        } catch (error) {
            frontendLogger.error("[FileImport]", "Build xlsx template failed", { error: getErrorMessage(error) });
            toast.error(t.fileImport.templateFailed);
        }
    };

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-dashed p-6 text-center">
                <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="mb-1 text-sm font-medium">{t.fileImport.pickHint}</p>
                <p className="mb-4 text-xs text-muted-foreground">{t.fileImport.supportedFormats.replace("{formats}", formatList)}</p>
                <ImportFileButton types={BANK_FILE_TYPES} onFile={onFile} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <span>{t.fileImport.templates}</span>
                <button type="button" onClick={() => void handleDownloadXlsxTemplate()} className="inline-flex items-center gap-1 underline hover:text-foreground">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    {t.fileImport.xlsxTemplate}
                </button>
                <button type="button" onClick={handleDownloadCsvTemplate} className="inline-flex items-center gap-1 underline hover:text-foreground">
                    <FileText className="h-3.5 w-3.5" />
                    {t.fileImport.csvTemplate}
                </button>
            </div>
        </div>
    );
}

interface FileImportSummaryViewProps {
    fileName: string;
    summary: FileImportSummary;
    notebookId: string;
    onNotebookChange: (value: string) => void;
    onConfirm: () => void;
    onReset: () => void;
}

/** 摘要视图：题数、错误与警告、未导入字段、目标错题本选择与确认 */
function FileImportSummaryView({ fileName, summary, notebookId, onNotebookChange, onConfirm, onReset }: FileImportSummaryViewProps) {
    const { t } = useLanguage();
    return (
        <div className="space-y-4" data-testid="file-import-summary">
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{fileName}</p>
                <Button variant="ghost" size="sm" onClick={onReset}>{t.fileImport.repick}</Button>
            </div>

            <p className="text-sm">
                {t.fileImport.totalQuestions.replace("{count}", String(summary.total))}
            </p>

            {summary.errorCount > 0 && (
                <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                    <p className="font-medium">{t.fileImport.errorsFound.replace("{count}", String(summary.errorCount))}</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                        {summary.errors.map((error, index) => (
                            <li key={index}>
                                {error.index >= 0
                                    ? t.fileImport.errorItem.replace("{index}", String(error.index + 1)).replace("{message}", error.message)
                                    : error.message}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {summary.warnings.length > 0 && (
                <div className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                    <ul className="list-inside list-disc space-y-0.5">
                        {summary.warnings.map((warning, index) => (
                            <li key={index}>{warning}</li>
                        ))}
                    </ul>
                </div>
            )}

            {summary.ignoredFieldTexts.length > 0 && (
                <p className="text-xs text-muted-foreground">
                    {t.fileImport.ignoredFields.replace("{fields}", summary.ignoredFieldTexts.join("、"))}
                </p>
            )}

            <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="file-import-notebook">{t.fileImport.targetNotebook}</label>
                <NotebookSelector value={notebookId} onChange={onNotebookChange} />
                {!notebookId && <p className="text-xs text-destructive">{t.fileImport.notebookRequired}</p>}
            </div>

            <Button
                onClick={onConfirm}
                disabled={!notebookId || summary.total === 0}
                className="w-full bg-gradient-to-r from-indigo-600 to-violet-500 font-medium text-white hover:from-indigo-700 hover:to-violet-600"
                size="lg"
            >
                {t.fileImport.confirm.replace("{count}", String(summary.total))}
            </Button>
        </div>
    );
}

interface ScannedPdfViewProps {
    fileName: string;
    pageCount: number;
    notebookId: string;
    onNotebookChange: (value: string) => void;
    onConfirm: (pages: number[]) => Promise<void>;
    onReset: () => void;
}

/** 扫描版 PDF 视图：说明 + 页码范围选择 + 目标错题本 + 确认转图片识别 */
function ScannedPdfView({ fileName, pageCount, notebookId, onNotebookChange, onConfirm, onReset }: ScannedPdfViewProps) {
    const { t } = useLanguage();
    const [rangeText, setRangeText] = useState("");
    const [rangeError, setRangeError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const handleConfirm = async () => {
        // 默认全部页；超过上限时要求用户手动缩小范围
        const text = rangeText.trim() ? rangeText : `1-${pageCount}`;
        const parsed = parsePageRanges(text, pageCount);
        if (!parsed.ok) {
            setRangeError(t.fileImport.pdfPageRangeInvalid.replace("{message}", parsed.error.message));
            return;
        }
        setRangeError(null);
        setSubmitting(true);
        try {
            await onConfirm(parsed.pages);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-4" data-testid="file-import-scanned-pdf">
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{fileName}</p>
                <Button variant="ghost" size="sm" onClick={onReset}>{t.fileImport.repick}</Button>
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                    <p className="font-medium">{t.fileImport.pdfScannedTitle.replace("{count}", String(pageCount))}</p>
                    <p>{t.fileImport.pdfScannedHint}</p>
                </div>
            </div>

            <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="scanned-pdf-range">
                    {t.fileImport.pdfPageRangeLabel.replace("{max}", String(MAX_SCAN_PAGES_PER_IMPORT))}
                </label>
                <input
                    id="scanned-pdf-range"
                    type="text"
                    inputMode="text"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder={t.fileImport.pdfPageRangePlaceholder}
                    value={rangeText}
                    onChange={(event) => {
                        setRangeText(event.target.value);
                        if (rangeError) setRangeError(null);
                    }}
                />
                {rangeError && <p className="text-xs text-destructive" role="alert">{rangeError}</p>}
            </div>

            <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="scanned-pdf-notebook">{t.fileImport.targetNotebook}</label>
                <NotebookSelector value={notebookId} onChange={onNotebookChange} />
                {!notebookId && <p className="text-xs text-destructive">{t.fileImport.notebookRequired}</p>}
            </div>

            <Button
                onClick={() => void handleConfirm()}
                disabled={!notebookId || submitting || pageCount === 0}
                className="w-full bg-gradient-to-r from-indigo-600 to-violet-500 font-medium text-white hover:from-indigo-700 hover:to-violet-600"
                size="lg"
            >
                {t.fileImport.pdfConfirm}
            </Button>
        </div>
    );
}
