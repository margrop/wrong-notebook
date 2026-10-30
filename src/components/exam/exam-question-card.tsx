"use client";

import { useState } from "react";
import Link from "next/link";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { formatDateTime } from "@/lib/date-time";
import { ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { RESULT_BADGE_CLASS } from "@/components/mastery-panel";
import { PracticeResultPicker } from "@/components/practice-result-picker";
import { QuestionFigure } from "@/components/question-figure";
import { ExamQuestionRegenerate } from "@/components/exam/exam-question-regenerate";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ExamQuestionDetail, PracticeResult } from "@/types/api";

interface ExamQuestionCardProps {
    paperId: string;
    question: ExamQuestionDetail;
    /** 录入模式下的待保存结果；undefined 表示非录入模式 */
    editingResult?: PracticeResult | null;
    onResultChange?: (result: PracticeResult) => void;
    /** 录入模式下删除某次已录入的结果 */
    onDeleteAttempt?: (attemptId: string) => void;
    /** 单题重新生成完成后回调 */
    onRegenerated?: () => void;
}

export function ExamQuestionCard({ paperId, question, editingResult, onResultChange, onDeleteAttempt, onRegenerated }: ExamQuestionCardProps) {
    const { t } = useLanguage();
    const { timeZone } = useTimeZone();
    const [showAnswer, setShowAnswer] = useState(false);
    const isEditing = editingResult !== undefined;
    // AI 错误码（如 AI_AUTH_ERROR: ...）映射为界面提示
    const errorText = (() => {
        if (!question.error) return "";
        if (question.error === "SOURCE_DELETED") return t.exam.sourceDeleted;
        const code = question.error.split(":")[0].trim();
        const mapped = (t.errors as Record<string, unknown>)[code];
        return typeof mapped === "string" ? mapped : question.error;
    })();

    return (
        <Card>
            <CardContent className="space-y-3 pt-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{question.order}.</span>
                    {question.errorItemId ? (
                        <Link href={`/error-items/${question.errorItemId}`} className="font-mono text-xs text-primary hover:underline">
                            {t.exam.source} {question.sourceShortId}
                        </Link>
                    ) : (
                        <span className="font-mono text-xs text-muted-foreground">
                            {question.sourceShortId} · {t.exam.sourceDeleted}
                        </span>
                    )}
                    {question.notebookName && <Badge variant="secondary">{question.notebookName}</Badge>}
                </div>

                {question.attempts.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        {question.attempts.map((attempt, index) => (
                            <Badge key={attempt.id} variant="outline" className={`gap-1 font-normal ${RESULT_BADGE_CLASS[attempt.result] || ""}`}>
                                <span>{t.exam.attemptLabel.replace("{n}", String(index + 1))}</span>
                                <span className="tabular-nums">{formatDateTime(attempt.createdAt, "MM-dd", timeZone)}</span>
                                <span className="font-semibold">{t.mastery.results[attempt.result]}</span>
                                {isEditing && onDeleteAttempt && (
                                    <button
                                        type="button"
                                        aria-label={t.mastery.deleteRecord}
                                        className="-mr-1 rounded hover:bg-black/10"
                                        onClick={() => onDeleteAttempt(attempt.id)}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                )}
                            </Badge>
                        ))}
                    </div>
                )}

                {question.status === "pending" && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t.exam.questionPending}
                    </p>
                )}
                {question.status === "failed" && (
                    <p className="text-sm text-destructive">{t.exam.questionFailed}{errorText ? `${t.common.colon}${errorText}` : ""}</p>
                )}
                {question.status === "ready" && question.questionText && (
                    <>
                        <MarkdownRenderer content={question.questionText} />
                        <QuestionFigure svg={question.figureSvg} />
                        <button
                            type="button"
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => setShowAnswer(!showAnswer)}
                        >
                            {showAnswer ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            {t.exam.showAnswer}
                        </button>
                        {showAnswer && (
                            <div className="space-y-2 rounded-md bg-muted/40 p-3">
                                {question.answerText && <MarkdownRenderer content={question.answerText} className="font-semibold" />}
                                {question.analysis && <MarkdownRenderer content={question.analysis} />}
                            </div>
                        )}
                    </>
                )}

                {!isEditing && onRegenerated && (
                    <ExamQuestionRegenerate paperId={paperId} question={question} onDone={onRegenerated} />
                )}

                {isEditing && question.status === "ready" && question.errorItemId && onResultChange && (
                    <PracticeResultPicker value={editingResult} onChange={onResultChange} size="sm" />
                )}
            </CardContent>
        </Card>
    );
}
