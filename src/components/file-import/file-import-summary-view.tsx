"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NotebookSelector } from "@/components/notebook-selector";
import { useLanguage } from "@/contexts/LanguageContext";
import type { FileImportSummary } from "@/lib/import/file-import-summary";
import type { PdfImageOption } from "@/lib/hooks/use-file-import";

interface FileImportSummaryViewProps {
    fileName: string;
    summary: FileImportSummary;
    /** 仅 PDF 解析结果有值：是否检测到图形（决定选项默认值与可用性） */
    pdfHasGraphics?: boolean;
    notebookId: string;
    onNotebookChange: (value: string) => void;
    onConfirm: (pdfImageOption: PdfImageOption) => void;
    onReset: () => void;
}

/** 摘要视图：题数、错误与警告、未导入字段、题目原图选项（PDF）、目标错题本选择与确认 */
export function FileImportSummaryView({ fileName, summary, pdfHasGraphics, notebookId, onNotebookChange, onConfirm, onReset }: FileImportSummaryViewProps) {
    const { t } = useLanguage();
    const [pdfImageOption, setPdfImageOption] = useState<PdfImageOption>("all");
    const showPdfImageOption = pdfHasGraphics !== undefined;
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

            {showPdfImageOption && (
                <div className="space-y-2" data-testid="pdf-image-option">
                    <p className="text-sm font-medium">{t.fileImport.pdfImageOptionTitle}</p>
                    <div className="flex flex-col gap-1.5">
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="radio"
                                name="pdf-image-option"
                                value="with-graphics"
                                checked={pdfImageOption === "with-graphics"}
                                onChange={() => setPdfImageOption("with-graphics")}
                                disabled={!pdfHasGraphics}
                                data-testid="pdf-image-option-with-graphics"
                            />
                            {t.fileImport.pdfImageOptionWithGraphics}
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="radio"
                                name="pdf-image-option"
                                value="all"
                                checked={pdfImageOption === "all"}
                                onChange={() => setPdfImageOption("all")}
                                data-testid="pdf-image-option-all"
                            />
                            {t.fileImport.pdfImageOptionAll}
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="radio"
                                name="pdf-image-option"
                                value="none"
                                checked={pdfImageOption === "none"}
                                onChange={() => setPdfImageOption("none")}
                                data-testid="pdf-image-option-none"
                            />
                            {t.fileImport.pdfImageOptionNone}
                        </label>
                    </div>
                </div>
            )}

            <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="file-import-notebook">{t.fileImport.targetNotebook}</label>
                <NotebookSelector value={notebookId} onChange={onNotebookChange} />
                {!notebookId && <p className="text-xs text-destructive">{t.fileImport.notebookRequired}</p>}
            </div>

            <Button
                onClick={() => onConfirm(pdfImageOption)}
                disabled={!notebookId || summary.total === 0}
                className="w-full bg-gradient-to-r from-indigo-600 to-violet-500 font-medium text-white hover:from-indigo-700 hover:to-violet-600"
                size="lg"
            >
                {t.fileImport.confirm.replace("{count}", String(summary.total))}
            </Button>
        </div>
    );
}
