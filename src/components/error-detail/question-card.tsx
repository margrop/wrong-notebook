"use client";

import { useState } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { RegenerateFigureButton } from "@/components/regenerate-figure-button";
import { ReplaceQuestionImageButton } from "@/components/replace-question-image-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { EditButton, SaveCancelButtons, SectionHeader } from "./edit-controls";
import { FigureScaleEditor } from "./figure-scale-editor";
import { QuestionMetadata } from "./question-metadata";
import { QuestionTags } from "./question-tags";
import { ToggleImage } from "./toggle-image";
import type { ErrorItemDetail, UpdateErrorItem } from "./types";
import { useEditableField } from "./use-editable-field";

interface QuestionCardProps {
    item: ErrorItemDetail;
    educationStage?: string;
    /** 保存字段到服务端并合并到页面状态，失败时抛出 */
    saveFields: (fields: Partial<ErrorItemDetail>) => Promise<void>;
    /** 只合并到页面状态（服务端已更新） */
    onUpdate: UpdateErrorItem;
    reload: () => Promise<void>;
    onEnlarge: (src: string) => void;
}

/** 题目卡片：题干与配图、知识点标签、题目信息和原图 */
export function QuestionCard({ item, educationStage, saveFields, onUpdate, reload, onEnlarge }: QuestionCardProps) {
    const { t } = useLanguage();
    const [showImage, setShowImage] = useState(false);
    const question = useEditableField({
        read: () => item.questionText,
        save: (questionText) => saveFields({ questionText }),
        logLabel: 'question',
    });

    return (
        <Card>
            <CardHeader><SectionHeader title={<CardTitle>{t.detail.question}</CardTitle>} actions={!question.editing && <EditButton onClick={question.start} />} /></CardHeader>
            <CardContent className="space-y-4">
                {question.editing ? (
                    <div className="space-y-3">
                        <MarkdownEditor value={question.value} onChange={question.setValue} placeholder="Enter question text..." rows={8} className="w-full font-mono text-sm" />
                        <SaveCancelButtons onSave={question.submit} onCancel={question.cancel} />
                    </div>
                ) : <>
                    <MarkdownRenderer content={item.questionText} />
                    <FigureScaleEditor
                        key={`${item.id}-${item.figureScale ?? 100}-${item.figureAlign ?? "center"}`}
                        svg={item.figureSvg}
                        scale={item.figureScale}
                        align={item.figureAlign}
                        onSave={(figureScale, figureAlign) => saveFields({ figureScale, figureAlign })}
                    />
                </>}

                <QuestionTags item={item} educationStage={educationStage} onChanged={reload} />
                <QuestionMetadata item={item} onChanged={reload} />

                <div className="pt-3">
                    <ToggleImage
                        src={item.originalImageUrl}
                        alt={t.detail.originalProblem || "Original Problem"}
                        showLabel={t.replaceImage?.view || "View original image"}
                        hideLabel={t.replaceImage?.hide || "Hide original image"}
                        variant="outline"
                        visible={showImage}
                        onVisibleChange={setShowImage}
                        onEnlarge={onEnlarge}
                        actions={<>
                            <ReplaceQuestionImageButton
                                errorItemId={item.id}
                                hasImage={!!item.originalImageUrl}
                                onDone={(originalImageUrl) => { onUpdate({ originalImageUrl }); setShowImage(true); }}
                            />
                            {item.originalImageUrl && <RegenerateFigureButton errorItemId={item.id} onDone={onUpdate} />}
                        </>}
                    />
                </div>
            </CardContent>
        </Card>
    );
}
