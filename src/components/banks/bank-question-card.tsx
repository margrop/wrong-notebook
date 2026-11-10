"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DifficultyStars } from "@/components/difficulty-stars";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { QuestionFigure } from "@/components/question-figure";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { confirmDialog, toast } from "@/lib/feedback";
import { getApiErrorMessage } from "@/lib/error-message";
import { GRADE_NAMES } from "@/lib/grade-options";
import { QUESTION_TYPE_NAMES_EN, QUESTION_TYPE_NAMES_ZH } from "@/lib/question/question-type";
import type { QuestionType } from "@/lib/question/question-type";
import type { BankQuestionRow } from "@/lib/question-bank/types";
import type { Notebook } from "@/types/api";

interface BankQuestionCardProps {
    bankId: string;
    question: BankQuestionRow;
    notebooks: Notebook[];
    onChanged: () => void;
}

/** 真题库题目卡片：题干、知识点、答案解析，可加入错题本或删除 */
export function BankQuestionCard({ bankId, question, notebooks, onChanged }: BankQuestionCardProps) {
    const { t, language } = useLanguage();
    const [notebookId, setNotebookId] = useState(notebooks[0]?.id ?? "");
    const [busy, setBusy] = useState(false);

    let options: Record<string, string> = {};
    try {
        options = question.optionsJson ? JSON.parse(question.optionsJson) as Record<string, string> : {};
    } catch {
        options = {};
    }

    const handleAdd = async () => {
        if (!notebookId) return;
        setBusy(true);
        try {
            const result = await apiClient.post<{ ok: boolean; duplicate?: boolean }>(
                `/api/question-banks/${bankId}/questions/${question.id}`,
                { notebookId },
            );
            toast.success(result.duplicate ? t.banks.duplicateAddedToItems : t.banks.addedToItems);
            onChanged();
        } catch (err) {
            toast.error(getApiErrorMessage(err) || t.banks.importFailed);
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async () => {
        if (!await confirmDialog(t.banks.deleteQuestionConfirm)) return;
        setBusy(true);
        try {
            await apiClient.delete(`/api/question-banks/${bankId}/questions/${question.id}`);
            onChanged();
        } catch (err) {
            toast.error(getApiErrorMessage(err) || t.banks.importFailed);
        } finally {
            setBusy(false);
        }
    };

    const questionTypeNames = language === "zh" ? QUESTION_TYPE_NAMES_ZH : QUESTION_TYPE_NAMES_EN;
    const gradeName = question.grade ? GRADE_NAMES[question.grade - 1] : null;

    return (
        <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {gradeName && <span>{gradeName}{question.semester ?? ""}</span>}
                {question.questionType && <span>{questionTypeNames[question.questionType as QuestionType] ?? question.questionType}</span>}
                <DifficultyStars value={question.difficultyStars} showUnrated={false} />
                {question.source && <span className="truncate">{question.source}</span>}
            </div>
            <MarkdownRenderer content={question.text} />
            {Object.keys(options).length > 0 && (
                <div className="space-y-1 text-sm">
                    {Object.entries(options).map(([key, value]) => (
                        <p key={key}><span className="font-medium">{key}. </span>{value}</p>
                    ))}
                </div>
            )}
            <QuestionFigure svg={question.figureSvg} />
            {question.knowledgePoints.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {question.knowledgePoints.map((point) => (
                        <span key={point} className="rounded-full bg-muted px-2 py-0.5 text-xs">{point}</span>
                    ))}
                </div>
            )}
            {(question.answer || question.analysis) && (
                <details className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                    <summary className="cursor-pointer font-medium">{t.practice.checkAnswer}</summary>
                    {question.answer && (
                        <p className="mt-2"><span className="font-medium">{t.practice.correctAnswer}{t.common.colon}</span>{question.answer}</p>
                    )}
                    {question.analysis && (
                        <div className="mt-2">
                            <p className="font-medium">{t.practice.detailedAnalysis}{t.common.colon}</p>
                            <MarkdownRenderer content={question.analysis} />
                        </div>
                    )}
                </details>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <select
                    value={notebookId}
                    onChange={(event) => setNotebookId(event.target.value)}
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                    aria-label={t.banks.targetNotebook}
                >
                    {notebooks.map((notebook) => (
                        <option key={notebook.id} value={notebook.id}>{notebook.name}</option>
                    ))}
                </select>
                <Button type="button" size="sm" variant="outline" onClick={handleAdd} disabled={busy || !notebookId}>
                    {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
                    {t.banks.addQuestionToItems}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={handleDelete} disabled={busy}>
                    <Trash2 className="mr-1 h-4 w-4" />
                    {t.banks.deleteQuestion}
                </Button>
            </div>
        </div>
    );
}
