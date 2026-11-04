"use client";

import { Badge } from "@/components/ui/badge";
import { RetagItemButton } from "@/components/retag-item-button";
import { TagInput } from "@/components/tag-input";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { inferSubjectFromName } from "@/lib/tags/knowledge-tags";
import { EditButton, SaveCancelButtons, SectionHeader } from "./edit-controls";
import { getItemTags } from "./types";
import type { ErrorItemDetail } from "./types";
import { useEditableField } from "./use-editable-field";

interface QuestionTagsProps {
    item: ErrorItemDetail;
    educationStage?: string;
    /** 标签保存或 AI 重新识别后重新加载错题 */
    onChanged: () => Promise<void> | void;
}

/** 题目的知识点标签：查看、手动编辑或由 AI 重新识别 */
export function QuestionTags({ item, educationStage, onChanged }: QuestionTagsProps) {
    const { t } = useLanguage();
    const tags = getItemTags(item);
    const field = useEditableField<string[]>({
        read: () => getItemTags(item),
        save: async (value) => {
            // 直接传递标签名称数组，后端会处理关联
            await apiClient.put(`/api/error-items/${item.id}`, { knowledgePoints: value });
            await onChanged();
        },
        logLabel: 'tags',
        successMessage: t.common?.messages?.tagUpdateSuccess || 'Tags updated successfully!',
        failureMessage: t.common?.messages?.updateFailed || 'Update failed',
    });

    return (
        <div className="space-y-2">
            <SectionHeader
                title={<h4 className="text-sm font-semibold">{t.editor?.tags || "Knowledge Tags"}</h4>}
                actions={!field.editing && <div className="flex"><RetagItemButton errorItemId={item.id} onDone={onChanged} onReload={onChanged} /><EditButton onClick={field.start} /></div>}
            />
            {field.editing ? (
                <div className="space-y-3">
                    <TagInput value={field.value} onChange={field.setValue} placeholder={t.editor?.tagsPlaceholder || "Enter or select knowledge tags..."} subject={inferSubjectFromName(item.subject?.name || null) || undefined} gradeStage={educationStage} />
                    <p className="text-xs text-muted-foreground">{t.editor?.tagsHint || "Select from standard or custom tags"}</p>
                    <SaveCancelButtons onSave={field.submit} onCancel={field.cancel}>
                        <RetagItemButton errorItemId={item.id} onSuggested={field.setValue} />
                    </SaveCancelButtons>
                </div>
            ) : <div className="flex flex-wrap gap-2">{tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div>}
        </div>
    );
}
