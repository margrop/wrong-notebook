"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GradeSemesterSelect } from "@/components/grade-semester-select";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { toast } from "@/lib/feedback";
import { getApiErrorMessage } from "@/lib/error-message";
import { frontendLogger } from "@/lib/frontend-logger";

interface BatchEditDialogProps {
    ids: string[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** 修改成功后由列表刷新卡片 */
    onEdited: () => void;
}

/** 多选栏的「批量编辑」对话框：勾选要修改的字段后统一设置来源或年级学期 */
export function BatchEditDialog({ ids, open, onOpenChange, onEdited }: BatchEditDialogProps) {
    const { t } = useLanguage();
    const [changeSource, setChangeSource] = useState(false);
    const [source, setSource] = useState("");
    const [changeGrade, setChangeGrade] = useState(false);
    const [gradeSemester, setGradeSemester] = useState("");
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (!changeSource && !changeGrade) {
            toast.error(t.notebook.batchEditNothing);
            return;
        }
        setSaving(true);
        try {
            const result = await apiClient.post<{ updated: number; failed: string[] }>("/api/error-items/batch-update", {
                ids,
                ...(changeSource ? { source: source.trim() || null } : {}),
                ...(changeGrade ? { gradeSemester: gradeSemester || null } : {}),
            });
            toast.success(t.notebook.batchEditSuccess.replace("{count}", String(result.updated)));
            setChangeSource(false);
            setChangeGrade(false);
            setSource("");
            setGradeSemester("");
            onOpenChange(false);
            onEdited();
        } catch (error) {
            frontendLogger.error('[BatchEditDialog]', 'Batch edit failed', { error });
            toast.error(getApiErrorMessage(error) || t.notebook.batchEditFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t.notebook.batchEditTitle.replace("{count}", String(ids.length))}</DialogTitle>
                    <DialogDescription>{t.notebook.batchEditDescription}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium">
                            <Checkbox checked={changeSource} onCheckedChange={(checked) => setChangeSource(checked === true)} />
                            {t.notebook.batchEditSource}
                        </label>
                        <Input
                            value={source}
                            onChange={(event) => setSource(event.target.value)}
                            disabled={!changeSource || saving}
                            maxLength={200}
                            placeholder={t.notebook.batchEditSourcePlaceholder}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium">
                            <Checkbox checked={changeGrade} onCheckedChange={(checked) => setChangeGrade(checked === true)} />
                            {t.notebook.batchEditGrade}
                        </label>
                        <GradeSemesterSelect
                            id="batch-edit-grade-semester"
                            value={gradeSemester}
                            onChange={setGradeSemester}
                            disabled={!changeGrade || saving}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        {t.common.cancel}
                    </Button>
                    <Button onClick={handleSave} disabled={saving || (!changeSource && !changeGrade)}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {saving ? t.notebook.batchEditSaving : t.notebook.batchEditConfirm}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
