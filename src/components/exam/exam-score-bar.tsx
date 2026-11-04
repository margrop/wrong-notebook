"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";
import { MAX_EXAM_SCORE, normalizeExamScore } from "@/lib/exam/exam-score";
import { frontendLogger } from "@/lib/frontend-logger";

interface ExamScoreBarProps {
    /** 当前各题分值 */
    scores: (number | null | undefined)[];
    disabled?: boolean;
    /** 保存「每题统一 N 分」；score 为 null 时清空整卷分值 */
    onSave: (score: number | null) => Promise<void>;
}

/** 批量设置整份试卷每题的统一分值。 */
export function ExamScoreBar({ scores, disabled, onSave }: ExamScoreBarProps) {
    const { t } = useLanguage();
    const setScores = scores.filter((score): score is number => typeof score === 'number');
    const isUniform = setScores.length === scores.length && new Set(setScores).size <= 1;
    const savedScore = isUniform ? setScores[0] ?? null : null;

    const [draft, setDraft] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    if (scores.length === 0) return null;

    const value = draft ?? (savedScore !== null ? String(savedScore) : "");
    const parsed = value.trim() === "" ? null : normalizeExamScore(Number(value));
    const valid = value.trim() === "" || parsed !== null;
    const changed = draft !== null && (parsed ?? null) !== savedScore;

    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!valid || !changed || saving) return;
        setSaving(true);
        try {
            await onSave(parsed);
            setDraft(null);
            toast.success(t.common.messages.saveSuccess);
        } catch (error) {
            frontendLogger.error("[ExamScoreBar]", "统一保存试卷分值失败", { error });
            toast.error(t.exam.saveQuestionScoreFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-3 text-sm">
            <span className="font-medium">{t.exam.uniformScore}</span>
            <Input
                type="number"
                min={0.1}
                max={MAX_EXAM_SCORE}
                step={0.1}
                value={value}
                disabled={saving || disabled}
                aria-invalid={!valid}
                aria-label={t.exam.uniformScore}
                placeholder={t.exam.questionScorePlaceholder}
                onChange={(event) => setDraft(event.target.value)}
                className="h-8 w-24"
            />
            <Button type="submit" size="sm" disabled={saving || disabled || !changed || !valid}>
                {saving ? t.common.progress.saving : t.common.save}
            </Button>
            {savedScore !== null && !isUniform && (
                <span className="text-xs text-muted-foreground">{t.exam.totalScoreUnscored.replace("{count}", String(scores.length - setScores.length))}</span>
            )}
            <p className="w-full text-xs text-muted-foreground">{t.exam.uniformScoreHint}</p>
            {!valid && <p className="w-full text-xs text-destructive">{t.exam.questionScoreInvalid}</p>}
        </form>
    );
}
