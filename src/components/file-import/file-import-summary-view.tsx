"use client";

import { Button } from "@/components/ui/button";
import { NotebookSelector } from "@/components/notebook-selector";
import { useLanguage } from "@/contexts/LanguageContext";
import type { FileImportSummary } from "@/lib/import/file-import-summary";

interface FileImportSummaryViewProps {
    fileName: string;
    summary: FileImportSummary;
    notebookId: string;
    onNotebookChange: (value: string) => void;
    onConfirm: () => void;
    onReset: () => void;
}

/** 摘要视图：题数、错误与警告、未导入字段、目标错题本选择与确认 */
export function FileImportSummaryView({ fileName, summary, notebookId, onNotebookChange, onConfirm, onReset }: FileImportSummaryViewProps) {
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
