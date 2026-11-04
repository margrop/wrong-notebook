"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";
import { MAX_EXAM_SCORE, normalizeExamScore } from "@/lib/exam/exam-score";
import { frontendLogger } from "@/lib/frontend-logger";

interface ExamQuestionScoreInputProps {
    questionId: string;
    /** 当前分值，null 表示未设 */
    score: number | null;
    disabled?: boolean;
    /** 保存单题分值；null 表示清空该题分值 */
    onSave: (questionId: string, score: number | null) => Promise<void>;
}

/** 试卷详情页单题分值输入：失焦或回车保存，留空并失焦清空分值。 */
export function ExamQuestionScoreInput({ questionId, score, disabled, onSave }: ExamQuestionScoreInputProps) {
    const { t } = useLanguage();
    const [draft, setDraft] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const value = draft ?? (score !== null ? String(score) : "");
    const trimmed = value.trim();
    const parsed = trimmed === "" ? null : normalizeExamScore(Number(trimmed));
    const valid = trimmed === "" || parsed !== null;
    const changed = parsed !== score;

    const save = async () => {
        if (!valid || !changed || saving) {
            if (draft !== null && !valid) return;
            setDraft(null);
            return;
        }
        setSaving(true);
        try {
            await onSave(questionId, parsed);
            setDraft(null);
        } catch (error) {
            frontendLogger.error("[ExamQuestionScore]", "保存单题分值失败", { error });
            toast.error(t.exam.saveQuestionScoreFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <span className="inline-flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground" htmlFor={`exam-score-${questionId}`}>
                {t.exam.questionScore}
            </label>
            <Input
                id={`exam-score-${questionId}`}
                type="number"
                min={0.1}
                max={MAX_EXAM_SCORE}
                step={0.1}
                value={value}
                disabled={saving || disabled}
                aria-invalid={!valid}
                placeholder={t.exam.questionScorePlaceholder}
                title={t.exam.questionScoreHint}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => void save()}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        void save();
                    }
                }}
                className="h-7 w-20 text-sm"
            />
        </span>
    );
}
