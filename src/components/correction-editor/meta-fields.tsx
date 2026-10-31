"use client";

import { DifficultyStars } from "@/components/difficulty-stars";
import { GradeSemesterSelect } from "@/components/grade-semester-select";
import { NotebookSelector } from "@/components/notebook-selector";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import type { CorrectionDraft, UpdateDraft } from "./types";

interface MetaFieldsProps {
    data: CorrectionDraft;
    /** 未手工选卷时由星级推算的卷别 */
    paperLevel: string;
    onChange: UpdateDraft;
}

/** 归属错题本、年级学期、卷别与难度星级 */
export function MetaFields({ data, paperLevel, onChange }: MetaFieldsProps) {
    const { t } = useLanguage();

    return (
        <>
            <div className="space-y-2">
                <Label>{t.editor.selectNotebook || "Select Notebook"}</Label>
                <NotebookSelector value={data.subjectId} onChange={(subjectId) => onChange({ subjectId })} />
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
                    <Select value={paperLevel} onValueChange={(val) => onChange({ paperLevel: val })}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="a">{t.editor.paperLevels?.a || "Paper A"}</SelectItem>
                            <SelectItem value="b">{t.editor.paperLevels?.b || "Paper B"}</SelectItem>
                            <SelectItem value="other">{t.editor.paperLevels?.other || "Other"}</SelectItem>
                        </SelectContent>
                    </Select>
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
