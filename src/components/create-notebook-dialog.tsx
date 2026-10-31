"use client";

import { useEffect, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNotebookScopeLabels } from "@/components/notebook-scope-label";

import { useLanguage } from "@/contexts/LanguageContext";
import { DEFAULT_NOTEBOOK_STAGE, NOTEBOOK_STAGES, STAGE_SUBJECTS, type NotebookStage, type NotebookSubject } from "@/lib/notebook-scope";
import { apiClient } from "@/lib/api-client";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";

export interface CreateNotebookInput {
    name: string;
    stage: NotebookStage;
    subjectKey: NotebookSubject;
    tagSet: string;
}

interface CreateNotebookDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreate: (input: CreateNotebookInput) => Promise<void>;
}

/** 从系统标签库查询可用的标签体系列表 */
async function fetchAvailableTagSets(): Promise<string[]> {
    try {
        const data = await apiClient.get<{ tagSets: string[] }>('/api/tags?tagSetsOnly=true');
        return data.tagSets?.length ? data.tagSets : ['default'];
    } catch {
        return ['default'];
    }
}

export function CreateNotebookDialog({ open, onOpenChange, onCreate }: CreateNotebookDialogProps) {
    const [name, setName] = useState("");
    const [stage, setStage] = useState<NotebookStage>(DEFAULT_NOTEBOOK_STAGE);
    const [subjectKey, setSubjectKey] = useState<NotebookSubject>(STAGE_SUBJECTS[DEFAULT_NOTEBOOK_STAGE][0]);
    const [tagSet, setTagSet] = useState("default");
    const [availableTagSets, setAvailableTagSets] = useState<string[]>(['default']);
    const [loading, setLoading] = useState(false);
    const { t } = useLanguage();
    const { stageLabel, subjectLabel } = useNotebookScopeLabels();

    // 打开对话框时加载可用标签体系
    useEffect(() => {
        if (open) {
            fetchAvailableTagSets().then(setAvailableTagSets);
        }
    }, [open]);

    const handleStageChange = (value: NotebookStage) => {
        setStage(value);
        // 切换学段后，原学科不在可选范围内时改为该学段的第一个学科
        if (!STAGE_SUBJECTS[value].includes(subjectKey)) {
            setSubjectKey(STAGE_SUBJECTS[value][0]);
        }
    };

    const handleCreate = async () => {
        if (!name.trim()) {
            toast.warning(t.notebooks?.dialog?.enterName || "Please enter notebook name");
            return;
        }

        setLoading(true);
        try {
            await onCreate({ name: name.trim(), stage, subjectKey, tagSet });
            setName("");
            onOpenChange(false);
        } catch (error) {
            frontendLogger.error('[CreateNotebook]', 'Failed to create notebook', { error });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t.notebooks?.dialog?.title || "Create New Notebook"}</DialogTitle>
                    <DialogDescription>
                        {t.notebooks?.dialog?.desc || "Create separate notebooks for different subjects or chapters"}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label htmlFor="notebook-stage">{t.notebooks.dialog.stageLabel}</Label>
                            <Select value={stage} onValueChange={(value) => handleStageChange(value as NotebookStage)}>
                                <SelectTrigger id="notebook-stage">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {NOTEBOOK_STAGES.map((value) => (
                                        <SelectItem key={value} value={value}>{stageLabel(value)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="notebook-subject">{t.notebooks.dialog.subjectLabel}</Label>
                            <Select value={subjectKey} onValueChange={(value) => setSubjectKey(value as NotebookSubject)}>
                                <SelectTrigger id="notebook-subject">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {STAGE_SUBJECTS[stage].map((value) => (
                                        <SelectItem key={value} value={value}>{subjectLabel(value)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    {availableTagSets.length > 1 && (
                        <div className="space-y-2">
                            <Label htmlFor="notebook-tagset">{t.notebooks.dialog.tagSetLabel}</Label>
                            <Select value={tagSet} onValueChange={setTagSet}>
                                <SelectTrigger id="notebook-tagset">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableTagSets.map((ts) => (
                                        <SelectItem key={ts} value={ts}>
                                            {ts === 'default'
                                                ? (t.notebooks.dialog.tagSetDefault || 'Built-in')
                                                : (t.notebooks.dialog.tagSetNames?.[ts] || ts)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground">{t.notebooks.dialog.scopeHint}</p>
                    <div className="space-y-2">
                        <Label htmlFor="name">{t.notebooks?.dialog?.nameLabel || "Notebook Name"}</Label>
                        <Input
                            id="name"
                            placeholder={t.notebooks?.dialog?.placeholder || "e.g. Math, Physics, Chemistry..."}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t.common.cancel}
                    </Button>
                    <Button onClick={handleCreate} disabled={loading || !name.trim()}>
                        {loading ? (t.notebooks?.dialog?.creating || "Creating...") : (t.notebooks?.dialog?.create || "Create")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
