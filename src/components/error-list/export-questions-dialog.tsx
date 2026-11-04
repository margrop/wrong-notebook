"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { getErrorMessage } from "@/lib/error-message";
import { buildQuestionsDocx } from "@/lib/question-format/to-docx";
import { buildQuestionsXlsx } from "@/lib/question-format/to-xlsx";
import type { StructuredQuestion } from "@/lib/question-format/types";

/** 导出格式 */
export type ExportFormat = "json" | "excel" | "word";

const FORMAT_STORAGE_KEY = "error-list-export-format";

/** 记住上次选择的导出格式（失败时静默回退默认值） */
function loadSavedFormat(): ExportFormat {
    try {
        const saved = window.localStorage.getItem(FORMAT_STORAGE_KEY);
        return saved === "excel" || saved === "word" ? saved : "json";
    } catch {
        return "json";
    }
}

function saveFormat(format: ExportFormat): void {
    try {
        window.localStorage.setItem(FORMAT_STORAGE_KEY, format);
    } catch {
        // localStorage 不可用时忽略
    }
}

/** 触发浏览器下载 */
function downloadBlob(blob: Blob, filename: string): void {
    const objectUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(objectUrl);
}

interface ExportQuestionsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedIds: string[];
}

/**
 * 导出选中错题的对话框。
 * 所有格式都先调用现有 export-questions 接口取得题目交换格式 JSON，
 * 再在浏览器端转换为对应文件（JSON 原样保存 / Excel 经 to-xlsx 转换）。
 */
export function ExportQuestionsDialog({ open, onOpenChange, selectedIds }: ExportQuestionsDialogProps) {
    const { t } = useLanguage();
    const [format, setFormat] = useState<ExportFormat>(loadSavedFormat);
    const [includeImages, setIncludeImages] = useState(false);
    const [includeAnswers, setIncludeAnswers] = useState(true);
    const [docxTitle, setDocxTitle] = useState("");
    const [exporting, setExporting] = useState(false);

    const handleFormatChange = (value: ExportFormat) => {
        setFormat(value);
        saveFormat(value);
    };

    const fetchQuestions = async (): Promise<{ questions: StructuredQuestion[]; skipped: number }> => {
        const res = await fetch("/api/error-items/export-questions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: selectedIds, includeImages }),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.message || "Export failed");
        }
        const skipped = Number(res.headers.get("X-Export-Skipped") ?? "0");
        const file = await res.json();
        const questions: StructuredQuestion[] = Array.isArray(file?.questions) ? file.questions : [];
        return { questions, skipped };
    };

    const handleExport = async () => {
        if (selectedIds.length === 0) return;
        setExporting(true);
        try {
            const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
            let skipped = 0;
            if (format === "excel") {
                const { questions, skipped: skippedCount } = await fetchQuestions();
                skipped = skippedCount;
                const blob = await buildQuestionsXlsx(questions);
                downloadBlob(blob, `wrong-notebook-questions-${dateStr}.xlsx`);
            } else if (format === "word") {
                const { questions, skipped: skippedCount } = await fetchQuestions();
                skipped = skippedCount;
                const title = docxTitle.trim() || `${t.notebook.exportJsonDialog.defaultDocxTitle} ${new Date().toISOString().slice(0, 10)}`;
                const blob = await buildQuestionsDocx(questions, {
                    title,
                    includeAnswers,
                    includeImages,
                });
                downloadBlob(blob, `wrong-notebook-questions-${dateStr}.docx`);
            } else {
                const res = await fetch("/api/error-items/export-questions", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ids: selectedIds, includeImages }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.message || "Export failed");
                }
                skipped = Number(res.headers.get("X-Export-Skipped") ?? "0");
                const blob = await res.blob();
                const filenameMatch = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/);
                downloadBlob(blob, filenameMatch ? filenameMatch[1] : `wrong-notebook-questions-${dateStr}.json`);
            }
            if (skipped > 0) {
                toast.success(t.notebook.exportJsonDialog.success);
                toast.warning(t.notebook.exportJsonDialog.emptyQuestionWarning.replace("{count}", String(skipped)));
            } else {
                toast.success(t.notebook.exportJsonDialog.success);
            }
            onOpenChange(false);
        } catch (error) {
            frontendLogger.error("[ErrorList]", "Export questions failed", { error });
            toast.error(t.notebook.exportJsonDialog.failed + "：" + getErrorMessage(error));
        } finally {
            setExporting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t.notebook.exportJsonDialog.title}</DialogTitle>
                    <DialogDescription>{t.notebook.exportJsonDialog.description}</DialogDescription>
                </DialogHeader>
                <div className="py-2">
                    <SegmentedControl<ExportFormat>
                        options={[
                            { value: "json", label: t.notebook.exportJsonDialog.formatJson },
                            { value: "excel", label: t.notebook.exportJsonDialog.formatExcel },
                            { value: "word", label: t.notebook.exportJsonDialog.formatWord },
                        ]}
                        value={format}
                        onChange={handleFormatChange}
                    />
                </div>
                {format === "excel" && (
                    <p className="text-sm text-muted-foreground">{t.notebook.exportJsonDialog.excelNote}</p>
                )}
                {format === "word" && (
                    <div className="space-y-3 py-2">
                        <div className="space-y-1">
                            <label htmlFor="docx-title" className="text-sm">
                                {t.notebook.exportJsonDialog.docxTitleLabel}
                            </label>
                            <input
                                id="docx-title"
                                type="text"
                                value={docxTitle}
                                onChange={(e) => setDocxTitle(e.target.value)}
                                placeholder={`${t.notebook.exportJsonDialog.defaultDocxTitle} ${new Date().toISOString().slice(0, 10)}`}
                                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                            />
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="include-answers"
                                checked={includeAnswers}
                                onCheckedChange={(checked) => setIncludeAnswers(checked === true)}
                            />
                            <label htmlFor="include-answers" className="text-sm cursor-pointer">
                                {t.notebook.exportJsonDialog.includeAnswers}
                            </label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="include-images"
                                checked={includeImages}
                                onCheckedChange={(checked) => setIncludeImages(checked === true)}
                            />
                            <label htmlFor="include-images" className="text-sm cursor-pointer">
                                {t.notebook.exportJsonDialog.includeImages}
                            </label>
                        </div>
                        <p className="text-sm text-muted-foreground">{t.notebook.exportJsonDialog.wordNote}</p>
                    </div>
                )}
                {format === "json" && (
                    <div className="flex items-center space-x-2 py-2">
                        <Checkbox
                            id="include-images"
                            checked={includeImages}
                            onCheckedChange={(checked) => setIncludeImages(checked === true)}
                        />
                        <label htmlFor="include-images" className="text-sm cursor-pointer">
                            {t.notebook.exportJsonDialog.includeImages}
                        </label>
                    </div>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={exporting}>
                        {t.notebook.exportJsonDialog.cancel}
                    </Button>
                    <Button onClick={handleExport} disabled={exporting || selectedIds.length === 0}>
                        {exporting ? t.notebook.exportJsonDialog.exporting : t.notebook.exportJsonDialog.export}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
