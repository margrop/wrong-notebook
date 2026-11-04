"use client";

import { useState } from "react";
import { FileJson, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportQuestionsDialog } from "@/components/error-list/export-questions-dialog";
import { QuestionSimilarityDialog } from "@/components/question-similarity-dialog";
import { useLanguage } from "@/contexts/LanguageContext";

interface ErrorListSelectionBarProps {
    selectedIds: string[];
    deleting: boolean;
    onCancel: () => void;
    onDelete: () => void;
}

export function ErrorListSelectionBar({ selectedIds, deleting, onCancel, onDelete }: ErrorListSelectionBarProps) {
    const { t } = useLanguage();
    const [exportDialogOpen, setExportDialogOpen] = useState(false);

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
                        disabled={selectedIds.length === 0}
                    >
                        <FileJson className="mr-2 h-4 w-4" />
                        {t.notebook.exportJson}
                    </Button>
                    <Button variant="outline" onClick={onCancel}><X className="mr-2 h-4 w-4" />{t.notebook.cancelSelect}</Button>
                    <Button variant="destructive" onClick={onDelete} disabled={selectedIds.length === 0 || deleting}>
                        <Trash2 className="mr-2 h-4 w-4" />{t.notebook.deleteSelected}
                    </Button>
                </div>
            </div>

            <ExportQuestionsDialog
                open={exportDialogOpen}
                onOpenChange={setExportDialogOpen}
                selectedIds={selectedIds}
            />
        </div>
    );
}
