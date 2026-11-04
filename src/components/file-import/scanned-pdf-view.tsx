"use client";

import { useState } from "react";
import { FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotebookSelector } from "@/components/notebook-selector";
import { useLanguage } from "@/contexts/LanguageContext";
import { MAX_SCAN_PAGES_PER_IMPORT, parsePageRanges } from "@/lib/import/file-parsers/pdf/render-pages";

interface ScannedPdfViewProps {
    fileName: string;
    pageCount: number;
    notebookId: string;
    onNotebookChange: (value: string) => void;
    onConfirm: (pages: number[]) => Promise<void>;
    onReset: () => void;
}

/** 扫描版 PDF 视图：说明 + 页码范围选择 + 目标错题本 + 确认转图片识别 */
export function ScannedPdfView({ fileName, pageCount, notebookId, onNotebookChange, onConfirm, onReset }: ScannedPdfViewProps) {
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
