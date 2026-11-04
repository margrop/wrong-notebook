"use client";

import { FileSpreadsheet, FileText, Upload } from "lucide-react";
import { ImportFileButton } from "@/components/import-file-button";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { getErrorMessage } from "@/lib/error-message";
import { BANK_FILE_TYPES } from "@/lib/import/file-read";
import type { ImportFileTypeDef } from "@/lib/import/file-read";
import { buildCsvTemplate, buildXlsxTemplate } from "@/lib/import/file-parsers/table-template";

/** 触发浏览器下载（内存中生成的 Blob 模板文件） */
function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}

interface FileImportPickViewProps {
    onFile: (file: File, type: ImportFileTypeDef) => Promise<void>;
}

/** 选择文件视图：上传区与 Excel / CSV 模板下载 */
export function FileImportPickView({ onFile }: FileImportPickViewProps) {
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
