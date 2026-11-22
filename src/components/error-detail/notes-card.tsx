"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { EditButton, SaveCancelButtons, SectionHeader } from "./edit-controls";
import type { ErrorItemDetail, UpdateErrorItem } from "./types";
import { useEditableField } from "./use-editable-field";

interface NotesCardProps {
    item: ErrorItemDetail;
    onUpdate: UpdateErrorItem;
}

/** 我的笔记（纯文本） */
export function NotesCard({ item, onUpdate }: NotesCardProps) {
    const { t } = useLanguage();
    const field = useEditableField({
        read: () => item.userNotes || "",
        save: async (userNotes) => {
            await apiClient.patch(`/api/error-items/${item.id}/notes`, { userNotes });
            onUpdate({ userNotes });
        },
        logLabel: 'notes',
        successMessage: t.common?.messages?.noteSaveSuccess || 'Notes saved successfully',
    });

    return (
        <Card>
            <CardHeader><SectionHeader title={<CardTitle>{t.detail.yourNotes}</CardTitle>} actions={!field.editing && <EditButton onClick={field.start} label={t.detail.editNotes} ariaLabel={`${t.common?.edit || "Edit"} ${t.detail.yourNotes}`} />} /></CardHeader>
            <CardContent>
                {field.editing ? (
                    <div className="space-y-3">
                        <Textarea value={field.value} onChange={e => field.setValue(e.target.value)} placeholder={t.detail.notesPlaceholder || "Enter your notes..."} rows={5} className="w-full" />
                        <SaveCancelButtons onSave={field.submit} onCancel={field.cancel} />
                    </div>
                ) : (
                    <div className="whitespace-pre-wrap">{item.userNotes ? <p className="text-foreground">{item.userNotes}</p> : <p className="text-muted-foreground italic">{t.detail.noNotes}</p>}</div>
                )}
            </CardContent>
        </Card>
    );
}
