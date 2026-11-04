"use client";

import { useState } from "react";
import { FileJson, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuestionSimilarityDialog } from "@/components/question-similarity-dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { getErrorMessage } from "@/lib/error-message";

interface ErrorListSelectionBarProps {
    selectedIds: string[];
    deleting: boolean;
    onCancel: () => void;
    onDelete: () => void;
}

export function ErrorListSelectionBar({ selectedIds, deleting, onCancel, onDelete }: ErrorListSelectionBarProps) {
    const { t } = useLanguage();
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const [includeImages, setIncludeImages] = useState(false);
    const [exporting, setExporting] = useState(false);

    const handleExport = async () => {
        if (selectedIds.length === 0) return;
        setExporting(true);
        try {
            const res = await fetch("/api/error-items/export-questions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: selectedIds, includeImages }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || "Export failed");
            }
            const blob = await res.blob();
            const objectUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objectUrl;
            const filenameMatch = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/);
            a.download = filenameMatch ? filenameMatch[1] : "wrong-notebook-questions.json";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(objectUrl);
            toast.success(t.notebook.exportJsonDialog.success);
            setExportDialogOpen(false);
        } catch (error) {
            frontendLogger.error("[ErrorList]", "Export questions failed", { error });
            toast.error(t.notebook.exportJsonDialog.failed + "：" + getErrorMessage(error));
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="pb-safe fixed bottom-0 left-0 right-0 z-50 border-t bg-card/95 p-4 shadow-lg backdrop-blur">
            <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1 text-sm text-muted-foreground">
                    <p>{t.notebook.selectedCount.replace("{count}", String(selectedIds.length))}</p>
                    <p className="text-xs">{t.questionSimilarity.selectTwo}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <QuestionSimilarityDialog ids={selectedIds} />
                    <Button
                        variant="outline"
                        onClick={() => setExportDialogOpen(true)}
                        disabled={selectedIds.length === 0 || exporting}
                    >
                        <FileJson className="mr-2 h-4 w-4" />
                        {exporting ? t.notebook.exportJsonDialog.exporting : t.notebook.exportJson}
                    </Button>
                    <Button variant="outline" onClick={onCancel}><X className="mr-2 h-4 w-4" />{t.notebook.cancelSelect}</Button>
                    <Button variant="destructive" onClick={onDelete} disabled={selectedIds.length === 0 || deleting}>
                        <Trash2 className="mr-2 h-4 w-4" />{t.notebook.deleteSelected}
                    </Button>
                </div>
            </div>

            <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t.notebook.exportJsonDialog.title}</DialogTitle>
                        <DialogDescription>{t.notebook.exportJsonDialog.description}</DialogDescription>
                    </DialogHeader>
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
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setExportDialogOpen(false)} disabled={exporting}>
                            {t.notebook.exportJsonDialog.cancel}
                        </Button>
                        <Button onClick={handleExport} disabled={exporting || selectedIds.length === 0}>
                            {exporting ? t.notebook.exportJsonDialog.exporting : t.notebook.exportJsonDialog.export}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
