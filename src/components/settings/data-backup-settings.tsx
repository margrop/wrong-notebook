"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, Download, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { downloadFile } from "@/lib/download-file";
import { confirmDialog, toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import type { Translations } from "@/lib/translations";

type ImportStats = Record<string, number | boolean | undefined>;

interface DataBackupSettingsProps {
    isAdmin: boolean;
}

function formatImportResult(stats: ImportStats, t: Translations): string {
    return (t.settings?.importResultDesc || "Imported {subjects} notebooks, {tags} tags, {items} error items, {schedules} review schedules, {records} practice records, {papers} exam papers and {voices} cloud voice clips.")
        .replace('{subjects}', String(stats.subjectsCreated))
        .replace('{tags}', String(stats.tagsCreated))
        .replace('{items}', String(stats.errorItemsCreated))
        .replace('{schedules}', String(stats.reviewSchedulesCreated))
        .replace('{records}', String(stats.practiceRecordsCreated))
        .replace('{papers}', String(stats.examPapersCreated ?? 0))
        .replace('{voices}', String(stats.ttsSpeechesImported ?? 0))
        .replace('{duplicates}', String(stats.duplicateErrorItems ?? 0));
}

/** 数据备份：导出、导入 JSON；管理员可导出、导入全部用户的数据 */
export function DataBackupSettings({ isAdmin }: DataBackupSettingsProps) {
    const { t } = useLanguage();
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const handleExport = async (all: boolean) => {
        if (all && !(await confirmDialog(t.settings?.exportAllConfirm || "Export all users' data? This may take a while."))) {
            return;
        }
        setExporting(true);
        try {
            await downloadFile(all ? '/api/export?all=true' : '/api/export', all ? 'wrong-notebook-export-all.json' : 'wrong-notebook-export.json');
            toast.success(t.settings?.exportSuccess || "Export successful");
        } catch (error) {
            frontendLogger.error('[DataBackupSettings]', all ? 'Export all failed' : 'Export failed', { error });
            toast.error(t.settings?.exportFailed || "Export failed");
        } finally {
            setExporting(false);
        }
    };

    const handleImport = async (all: boolean) => {
        if (!selectedFile) return;
        const confirmText = all
            ? (t.settings?.importAllConfirm || "Import all users' data? This will restore data for all users from the export file.")
            : (t.settings?.importConfirm || "Are you sure you want to import?");
        if (!(await confirmDialog(confirmText))) {
            return;
        }

        setImporting(true);
        try {
            const data = JSON.parse(await selectedFile.text());
            const { stats } = await apiClient.post<{ stats: ImportStats }>(all ? '/api/import?all=true' : '/api/import', data);
            toast.success(formatImportResult(stats, t));
            setSelectedFile(null);
            window.location.reload();
        } catch (error) {
            frontendLogger.error('[DataBackupSettings]', all ? 'Import all failed' : 'Import failed', { error });
            toast.error(t.settings?.importFailed || "Import failed");
        } finally {
            setImporting(false);
        }
    };

    const spinnerOr = (busy: boolean, icon: ReactNode) => busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : icon;

    return (
        <div className="p-4 border border-blue-200 rounded-lg bg-blue-50">
            <h4 className="text-sm font-bold text-blue-900 mb-3">
                {t.settings?.dataManagement || "Data Management"}
            </h4>

            {/* Export */}
            <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-blue-800 font-medium">
                        {t.settings?.exportData || "Export Data"}
                    </span>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleExport(false)}
                            disabled={exporting}
                            className="bg-blue-100 hover:bg-blue-200 text-blue-900 border-blue-300"
                        >
                            {spinnerOr(exporting, <Download className="mr-2 h-4 w-4" />)}
                            {t.settings?.exportData || "Export"}
                        </Button>
                        {isAdmin && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleExport(true)}
                                disabled={exporting}
                                className="bg-orange-100 hover:bg-orange-200 text-orange-900 border-orange-300"
                            >
                                {spinnerOr(exporting, <Download className="mr-2 h-4 w-4" />)}
                                {t.settings?.exportAllData || "Export All"}
                            </Button>
                        )}
                    </div>
                </div>
                <p className="text-xs text-blue-700">
                    {t.settings?.exportDataDesc || "Export all data as JSON file."}
                </p>
            </div>

            {/* Import */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-blue-800 font-medium">
                        {t.settings?.importData || "Import Data"}
                    </span>
                    <div className="flex items-center gap-2">
                        <input
                            type="file"
                            accept=".json"
                            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? selectedFile)}
                            className="hidden"
                            id="import-file-input"
                            disabled={importing}
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => document.getElementById('import-file-input')?.click()}
                            disabled={importing}
                            className="bg-blue-100 hover:bg-blue-200 text-blue-900 border-blue-300"
                        >
                            {spinnerOr(importing, <Upload className="mr-2 h-4 w-4" />)}
                            {selectedFile?.name || t.settings?.selectFile || "Select File"}
                        </Button>
                        {selectedFile && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleImport(false)}
                                disabled={importing}
                                className="bg-green-100 hover:bg-green-200 text-green-900 border-green-300"
                            >
                                {spinnerOr(importing, <CheckCircle2 className="mr-2 h-4 w-4" />)}
                                {t.settings?.importData || "Import"}
                            </Button>
                        )}
                        {selectedFile && isAdmin && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleImport(true)}
                                disabled={importing}
                                className="bg-orange-100 hover:bg-orange-200 text-orange-900 border-orange-300"
                            >
                                {spinnerOr(importing, <CheckCircle2 className="mr-2 h-4 w-4" />)}
                                {t.settings?.importAllData || "Import All"}
                            </Button>
                        )}
                    </div>
                </div>
                <p className="text-xs text-blue-700">
                    {t.settings?.importDataDesc || "Import data from JSON file. Existing data will be skipped."}
                </p>
            </div>
        </div>
    );
}
