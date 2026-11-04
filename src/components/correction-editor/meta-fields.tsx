"use client";

import { DifficultyStars } from "@/components/difficulty-stars";
import { GradeSemesterSelect } from "@/components/grade-semester-select";
import { NotebookSelector } from "@/components/notebook-selector";
import { PaperGroupSelect } from "@/components/paper-group-select";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { NO_QUESTION_TYPE, QUESTION_TYPES } from "@/lib/question/question-type";
import type { CorrectionDraft, UpdateDraft } from "./types";

interface MetaFieldsProps {
    data: CorrectionDraft;
    /** 未手工选卷时由星级推算的卷别分组 id */
    paperLevel: string;
    onChange: UpdateDraft;
}

/** 归属错题本、题型、年级学期、卷别与难度星级 */
export function MetaFields({ data, paperLevel, onChange }: MetaFieldsProps) {
    const { t } = useLanguage();

    return (
        <>
            <div className="space-y-2">
                <Label>{t.editor.selectNotebook || "Select Notebook"}</Label>
                <NotebookSelector value={data.subjectId} onChange={(subjectId) => onChange({ subjectId })} />
            </div>

            <div className="space-y-2">
                <Label>{t.questionType.label || "Question Type"}</Label>
                <Select
                    value={data.questionType || ""}
                    onValueChange={(value) => onChange({ questionType: value === NO_QUESTION_TYPE ? null : value })}
                >
                    <SelectTrigger>
                        <SelectValue placeholder={t.questionType.notSet || "Not set"} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={NO_QUESTION_TYPE}>{t.questionType.clear || "Clear"}</SelectItem>
                        {QUESTION_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                                {t.questionType.names?.[type] || type}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="correction-grade-semester">{t.editor.gradeSemester || "Grade/Semester"}</Label>
                    <GradeSemesterSelect
                        id="correction-grade-semester"
                        value={data.gradeSemester || ""}
                        onChange={(gradeSemester) => onChange({ gradeSemester })}
                    />
                </div>
                <div className="space-y-2">
                    <Label>{t.editor.paperLevel || "Paper Level"}</Label>
                    <PaperGroupSelect value={paperLevel} onChange={(val) => onChange({ paperLevel: val })} />
                </div>
            </div>

            <div className="space-y-2">
                <Label>{t.difficulty.label}</Label>
                <div>
                    <DifficultyStars size="md" value={data.difficultyStars} onChange={(difficultyStars) => onChange({ difficultyStars })} />
                </div>
            </div>
        </>
    );
}
