"use client";

import type { ReactNode } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { EditButton, SaveCancelButtons, SectionHeader } from "./edit-controls";
import { useEditableField } from "./use-editable-field";

interface MarkdownFieldCardProps {
    title: string;
    value: string | null | undefined;
    onSave: (value: string) => Promise<void>;
    logLabel: string;
    rows: number;
    placeholder?: string;
    /** 编辑框上方的说明文字 */
    editorLabel?: string;
    /** 内容为空时显示的提示，不传则直接渲染空内容 */
    emptyText?: string;
    cardClassName?: string;
    titleClassName?: string;
    contentClassName?: string;
    /** 非编辑状态下标题右侧、编辑按钮之前的按钮 */
    headerActions?: ReactNode;
    /** 显示在内容下方（编辑与查看状态都显示） */
    children?: ReactNode;
}

/** 可编辑的 Markdown 字段卡片：答案、解析、错因分析等 */
export function MarkdownFieldCard({ title, value, onSave, logLabel, rows, placeholder, editorLabel, emptyText, cardClassName, titleClassName, contentClassName, headerActions, children }: MarkdownFieldCardProps) {
    const { t } = useLanguage();
    const field = useEditableField({ read: () => value || "", save: onSave, logLabel });
    const editor = <MarkdownEditor value={field.value} onChange={field.setValue} placeholder={placeholder} rows={rows} className="w-full font-mono text-sm" />;

    return (
        <Card className={cardClassName}>
            <CardHeader>
                <SectionHeader
                    title={<CardTitle className={titleClassName}>{title}</CardTitle>}
                    actions={!field.editing && <div className="flex flex-wrap justify-end">{headerActions}<EditButton onClick={field.start} ariaLabel={`${t.common?.edit || "Edit"} ${title}`} /></div>}
                />
            </CardHeader>
            <CardContent className="space-y-4">
                {field.editing ? (
                    <div className="space-y-3">
                        {editorLabel ? <div className="space-y-2"><label className="text-sm text-muted-foreground">{editorLabel}</label>{editor}</div> : editor}
                        <SaveCancelButtons onSave={field.submit} onCancel={field.cancel} />
                    </div>
                ) : (!value && emptyText) ? (
                    <p className="text-sm text-muted-foreground italic">{emptyText}</p>
                ) : <MarkdownRenderer content={value} className={contentClassName} />}
                {children}
            </CardContent>
        </Card>
    );
}
