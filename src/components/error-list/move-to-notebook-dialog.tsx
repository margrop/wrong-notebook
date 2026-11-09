"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NotebookSelector } from "@/components/notebook-selector";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";

interface MoveToNotebookDialogProps {
    ids: string[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** 移动成功后由列表退出多选模式并刷新 */
    onMoved: () => void;
}

/** 多选栏的「移动到错题本」对话框：选目标错题本后批量移动，标签保持不变 */
export function MoveToNotebookDialog({ ids, open, onOpenChange, onMoved }: MoveToNotebookDialogProps) {
    const { t } = useLanguage();
    const [subjectId, setSubjectId] = useState("");
    const [moving, setMoving] = useState(false);

    const handleMove = async () => {
        if (!subjectId) return;
        setMoving(true);
        try {
            const { moved } = await apiClient.post<{ moved: number; failed: string[] }>("/api/error-items/batch-move", {
                ids,
                subjectId,
            });
            toast.success(t.notebook.moveSuccess.replace("{count}", String(moved)));
            setSubjectId("");
            onOpenChange(false);
            onMoved();
        } catch (error) {
            frontendLogger.error('[MoveToNotebookDialog]', 'Batch move failed', { error });
            toast.error(t.notebook.moveFailed);
        } finally {
            setMoving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t.notebook.moveDialogTitle}</DialogTitle>
                    <DialogDescription>
                        {t.notebook.moveDialogDescription.replace("{count}", String(ids.length))}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 py-4">
                    <label className="text-sm text-muted-foreground">{t.notebook.moveTargetLabel}</label>
                    <NotebookSelector value={subjectId || undefined} onChange={setSubjectId} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={moving}>
                        {t.common.cancel}
                    </Button>
                    <Button onClick={handleMove} disabled={!subjectId || moving}>
                        {moving ? t.notebook.moving : t.notebook.moveConfirm}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
