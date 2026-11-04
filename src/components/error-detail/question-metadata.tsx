"use client";

import { NotebookSelector } from "@/components/notebook-selector";
import { GradeSemesterSelect } from "@/components/grade-semester-select";
import { PaperGroupSelect } from "@/components/paper-group-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { NO_QUESTION_TYPE, QUESTION_TYPES } from "@/lib/question/question-type";
import { usePaperGroups } from "@/lib/hooks/use-paper-groups";
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
    questionType: string;
}

/** 题目信息：所属错题本、题型、年级学期、卷别 */
export function QuestionMetadata({ item, onChanged }: QuestionMetadataProps) {
    const { t } = useLanguage();
    const notSet = t.common?.notSet || "Not set";
    const { groups } = usePaperGroups();

    const groupName = (id: string | null | undefined) => {
        if (!id) return notSet;
        const g = groups.find((g) => g.id === id);
        return g?.name || id;
    };

    const questionTypeLabel = (key: string | null | undefined) => {
        if (!key) return notSet;
        return t.questionType.names?.[key] || key;
    };

    const field = useEditableField<MetadataForm>({
        read: () => ({
            subjectId: item.subjectId || null,
            gradeSemester: item.gradeSemester || "",
            paperLevel: item.paperLevel || "",
            questionType: item.questionType || "",
        }),
        save: async (value) => {
            // 只提交改动的关联字段，未分类题目及已停用分组中的题目也能单独修改年级。
            const { subjectId, paperLevel, questionType, ...metadata } = value;
            await apiClient.put(`/api/error-items/${item.id}`, {
                ...metadata,
                ...(paperLevel !== (item.paperLevel || "") ? { paperLevel: paperLevel || null } : {}),
                ...(subjectId !== (item.subjectId || null) ? { subjectId } : {}),
                ...(questionType !== (item.questionType || "") ? { questionType: questionType || null } : {}),
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
                    <div className="space-y-2"><label className="text-sm text-muted-foreground">{t.questionType.label || "Question Type"}</label>
                        <Select value={field.value.questionType} onValueChange={(val) => update({ questionType: val === NO_QUESTION_TYPE ? "" : val })}>
                            <SelectTrigger><SelectValue placeholder={t.questionType.notSet || "Not set"} /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_QUESTION_TYPE}>{t.questionType.clear || "Clear"}</SelectItem>
                                {QUESTION_TYPES.map((type) => (
                                    <SelectItem key={type} value={type}>{t.questionType.names?.[type] || type}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2"><label htmlFor="detail-grade-semester" className="text-sm text-muted-foreground">{t.editor.gradeSemester}</label><GradeSemesterSelect id="detail-grade-semester" value={field.value.gradeSemester} onChange={(gradeSemester) => update({ gradeSemester })} /></div>
                    <div className="space-y-2"><label className="text-sm text-muted-foreground">{t.filter.paperLevel}</label><PaperGroupSelect value={field.value.paperLevel} onChange={(paperLevel) => update({ paperLevel })} /></div>
                    <SaveCancelButtons onSave={field.submit} onCancel={field.cancel} />
                </div>
            ) : (
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">{t.notebooks?.title || "Notebook"}:</span><span className="font-medium">{item.subject?.name || notSet}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t.questionType.label || "Question Type"}:</span><span className="font-medium">{questionTypeLabel(item.questionType)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t.editor.gradeSemester}:</span><span className="font-medium">{item.gradeSemester || notSet}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t.filter.paperLevel}:</span><span className="font-medium">{groupName(item.paperLevel)}</span></div>
                </div>
            )}
        </div>
    );
}
