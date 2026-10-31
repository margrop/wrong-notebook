"use client";

import { NotebookSelector } from "@/components/notebook-selector";
import { GradeSemesterSelect } from "@/components/grade-semester-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { getDefaultPaperLevel } from "@/lib/paper-level";
import { EditButton, SaveCancelButtons, SectionHeader } from "./edit-controls";
import type { ErrorItemDetail } from "./types";
import { useEditableField } from "./use-editable-field";

interface QuestionMetadataProps {
    item: ErrorItemDetail;
    /** 保存后重新加载错题（错题本名称等需要从服务端取） */
    onChanged: () => Promise<void> | void;
}

interface MetadataForm {
    subjectId: string | null;
    gradeSemester: string;
    paperLevel: string;
}

/** 题目信息：所属错题本、年级学期、卷别 */
export function QuestionMetadata({ item, onChanged }: QuestionMetadataProps) {
    const { t } = useLanguage();
    const notSet = t.common?.notSet || "Not set";
    const field = useEditableField<MetadataForm>({
        read: () => ({
            subjectId: item.subjectId || null,
            gradeSemester: item.gradeSemester || "",
            paperLevel: item.paperLevel || getDefaultPaperLevel(item.difficultyStars) || "a",
        }),
        save: async (value) => {
            // 只改年级时不重复提交错题本，未归类题目也能保存。
            const { subjectId, ...metadata } = value;
            await apiClient.put(`/api/error-items/${item.id}`, {
                ...metadata,
                ...(subjectId !== (item.subjectId || null) ? { subjectId } : {}),
            });
            await onChanged();
        },
        logLabel: 'metadata',
        successMessage: t.common?.messages?.metaUpdateSuccess || 'Metadata updated successfully!',
        failureMessage: t.common?.messages?.updateFailed || 'Update failed',
    });
    const update = (fields: Partial<MetadataForm>) => field.setValue({ ...field.value, ...fields });

    return (
        <div className="space-y-2 pt-4 border-t">
            <SectionHeader
                title={<h4 className="text-sm font-semibold">{t.detail?.questionInfo || "Question Info"}</h4>}
                actions={!field.editing && <EditButton onClick={field.start} />}
            />
            {field.editing ? (
                <div className="space-y-3">
                    <div className="space-y-2"><label className="text-sm text-muted-foreground">{t.notebooks?.title || "Notebook"}</label><NotebookSelector value={field.value.subjectId || undefined} onChange={(subjectId) => update({ subjectId })} /></div>
                    <div className="space-y-2"><label htmlFor="detail-grade-semester" className="text-sm text-muted-foreground">{t.editor.gradeSemester}</label><GradeSemesterSelect id="detail-grade-semester" value={field.value.gradeSemester} onChange={(gradeSemester) => update({ gradeSemester })} /></div>
                    <div className="space-y-2"><label className="text-sm text-muted-foreground">{t.filter.paperLevel}</label><Select value={field.value.paperLevel} onValueChange={(paperLevel) => update({ paperLevel })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="a">{t.editor.paperLevels?.a || "Paper A"}</SelectItem><SelectItem value="b">{t.editor.paperLevels?.b || "Paper B"}</SelectItem><SelectItem value="other">{t.editor.paperLevels?.other || "Other"}</SelectItem></SelectContent></Select></div>
                    <SaveCancelButtons onSave={field.submit} onCancel={field.cancel} />
                </div>
            ) : (
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">{t.notebooks?.title || "Notebook"}:</span><span className="font-medium">{item.subject?.name || notSet}</span></div>
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-muted-foreground">{t.editor.gradeSemester}:</span><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{item.gradeSemester || notSet}</span><EditButton onClick={field.start} label={t.gradeSelection.edit} /></div></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t.filter.paperLevel}:</span><span className="font-medium">{item.paperLevel ? (t.editor.paperLevels?.[item.paperLevel as "a" | "b" | "other"] || item.paperLevel) : notSet}</span></div>
                </div>
            )}
        </div>
    );
}
