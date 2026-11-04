"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import type { BatchDraft, DraftItem } from "@/lib/question-split/draft";
import { updateItem } from "@/lib/question-split/draft-ops";
import { normalizeQuestionType, NO_QUESTION_TYPE, QUESTION_TYPES } from "@/lib/question/question-type";

interface DraftItemFieldsProps {
    item: DraftItem;
    onEdit: (change: (draft: BatchDraft) => BatchDraft) => void;
}

const DIFFICULTY_OPTIONS = [1, 2, 3, 4, 5] as const;

/** 题型选择：未设置（清除）+ 全部标准题型 */
const QUESTION_TYPE_SELECT_OPTIONS = [NO_QUESTION_TYPE, ...QUESTION_TYPES] as const;

/** 一道题的结构化字段（答案、解析、知识点、难度、错答）的可折叠编辑区 */
export function DraftItemFields({ item, onEdit }: DraftItemFieldsProps) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);

    const hasAnyField = Boolean(
        item.answer?.trim() || item.analysis?.trim() || item.knowledgePoints?.length || item.difficultyStars != null || item.wrongAnswer?.trim(),
    );

    return (
        <div className="rounded-lg border border-dashed p-2">
            <button
                type="button"
                className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
            >
                <span>{t.importBatch.fields.title}</span>
                {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>

            {open && (
                <div className="mt-2 space-y-3">
                    <div className="space-y-1">
                        <Label htmlFor={`${item.key}-type`} className="text-xs">{t.questionType.label}</Label>
                        <Select
                            value={item.questionType ?? NO_QUESTION_TYPE}
                            onValueChange={(value) => onEdit((draft) => updateItem(draft, item.key, { questionType: value === NO_QUESTION_TYPE ? null : normalizeQuestionType(value) }))}
                        >
                            <SelectTrigger className="h-8 w-full text-sm" aria-label={t.questionType.label}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {QUESTION_TYPE_SELECT_OPTIONS.map((key) => (
                                    <SelectItem key={key} value={key}>
                                        {key === NO_QUESTION_TYPE ? t.questionType.notSet : t.questionType.names[key]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor={`${item.key}-answer`} className="text-xs">{t.importBatch.fields.answer}</Label>
                        <Textarea
                            id={`${item.key}-answer`}
                            value={item.answer ?? ""}
                            onChange={(event) => onEdit((draft) => updateItem(draft, item.key, { answer: event.target.value }))}
                            className="min-h-16 text-sm"
                            placeholder={t.importBatch.fields.answerPlaceholder}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor={`${item.key}-analysis`} className="text-xs">{t.importBatch.fields.analysis}</Label>
                        <Textarea
                            id={`${item.key}-analysis`}
                            value={item.analysis ?? ""}
                            onChange={(event) => onEdit((draft) => updateItem(draft, item.key, { analysis: event.target.value }))}
                            className="min-h-20 text-sm"
                            placeholder={t.importBatch.fields.analysisPlaceholder}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor={`${item.key}-knowledge`} className="text-xs">{t.importBatch.fields.knowledgePoints}</Label>
                        <Input
                            id={`${item.key}-knowledge`}
                            value={(item.knowledgePoints ?? []).join(", ")}
                            onChange={(event) => onEdit((draft) => updateItem(draft, item.key, { knowledgePoints: event.target.value.split(/[,，、]/).map((point) => point.trim()).filter(Boolean) }))}
                            className="text-sm"
                            placeholder={t.importBatch.fields.knowledgePlaceholder}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">{t.importBatch.fields.difficulty}</Label>
                        <Select
                            value={item.difficultyStars != null ? String(item.difficultyStars) : "none"}
                            onValueChange={(value) => onEdit((draft) => updateItem(draft, item.key, { difficultyStars: value === "none" ? null : Number(value) }))}
                        >
                            <SelectTrigger className="h-8 w-full text-sm" aria-label={t.importBatch.fields.difficulty}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">{t.importBatch.fields.difficultyNone}</SelectItem>
                                {DIFFICULTY_OPTIONS.map((level) => (
                                    <SelectItem key={level} value={String(level)}>
                                        {"★".repeat(level)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor={`${item.key}-wrong`} className="text-xs">{t.importBatch.fields.wrongAnswer}</Label>
                        <Textarea
                            id={`${item.key}-wrong`}
                            value={item.wrongAnswer ?? ""}
                            onChange={(event) => onEdit((draft) => updateItem(draft, item.key, { wrongAnswer: event.target.value }))}
                            className="min-h-16 text-sm"
                            placeholder={t.importBatch.fields.wrongAnswerPlaceholder}
                        />
                    </div>
                </div>
            )}

            {!open && hasAnyField && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                    {[
                        item.answer?.trim() && t.importBatch.fields.answer,
                        item.analysis?.trim() && t.importBatch.fields.analysis,
                        item.knowledgePoints?.length && `${t.importBatch.fields.knowledgePoints}（${item.knowledgePoints.length}）`,
                        item.difficultyStars != null && "★".repeat(item.difficultyStars),
                        item.wrongAnswer?.trim() && t.importBatch.fields.wrongAnswer,
                    ].filter(Boolean).join(" · ")}
                </p>
            )}
        </div>
    );
}
