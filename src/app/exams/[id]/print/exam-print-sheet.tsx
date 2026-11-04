"use client";

import { forwardRef } from "react";
import { FigureScaleEditor } from "@/components/error-detail/figure-scale-editor";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { AnswerSpaceControl } from "@/components/print-preview/answer-space-control";
import { useLanguage } from "@/contexts/LanguageContext";
import { resolveQuestionAnswerSpacePx } from "@/lib/exam/exam-answer-space";
import type { AnswerSpaceMode } from "@/lib/exam/exam-answer-space";
import { formatExamScore, summarizeExamScores } from "@/lib/exam/exam-score";
import type { FigureAlign } from "@/lib/figure-scale";
import type { ExamPaperDetail } from "@/types/api";

interface ExamPrintSheetProps {
    paper: ExamPaperDetail;
    includeAnswers: boolean;
    answerSpace: AnswerSpaceMode;
    customSpaces: Record<string, number>;
    uniformPreview: { scale: number | null; align: FigureAlign | null };
    onSaveFigureScale: (questionId: string, figureScale: number, figureAlign: FigureAlign) => Promise<void>;
    onChangeCustomSpace: (questionId: string, px: number | null) => void;
}

/** 打印预览中的试卷正文：标题、满分行、各题与可选答案页。 */
export const ExamPrintSheet = forwardRef<HTMLDivElement, ExamPrintSheetProps>(function ExamPrintSheet({
    paper,
    includeAnswers,
    answerSpace,
    customSpaces,
    uniformPreview,
    onSaveFigureScale,
    onChangeCustomSpace,
}, ref) {
    const { t, language } = useLanguage();
    const questions = paper.questions.filter((question) => question.status === "ready" && question.questionText);
    // 满分只统计已设分值的题目；全部未设时不显示满分行，打印与旧版一致
    const fullScore = summarizeExamScores(questions.map((question) => question.score ?? null)).total;
    const scoreUnit = language === "en" ? "pts" : "分";

    return (
        <div ref={ref} className="exam-sheet">
            <h1>{paper.title}</h1>
            {fullScore !== null && (
                <p className="exam-full-score">{t.exam.fullScore.replace("{total}", formatExamScore(fullScore))}</p>
            )}
            <div className="exam-meta">
                <span>{t.exam.nameLine}{t.common.colon}________</span>
                <span>{t.exam.dateLine}{t.common.colon}________</span>
                <span>{t.exam.scoreLine}{t.common.colon}________</span>
            </div>
            {questions.map((question, index) => (
                <section key={question.id} className="exam-question">
                    <div className="exam-question-head">
                        <span>
                            {index + 1}.
                            {typeof question.score === 'number' && `（${formatExamScore(question.score)} ${scoreUnit}）`}
                        </span>
                        <span className="exam-source">{t.exam.sourceLabel}: {question.sourceShortId}</span>
                    </div>
                    <MarkdownRenderer content={question.questionText!} />
                    <FigureScaleEditor
                        key={`${question.id}-${question.figureScale ?? 100}-${question.figureAlign ?? "center"}`}
                        svg={question.figureSvg}
                        scale={question.figureScale}
                        align={question.figureAlign}
                        previewScaleOverride={uniformPreview.scale}
                        previewAlignOverride={uniformPreview.align}
                        onSave={(figureScale, figureAlign) => onSaveFigureScale(question.id, figureScale, figureAlign)}
                    />
                    {(() => {
                        const effectivePx = resolveQuestionAnswerSpacePx(answerSpace, question.questionText!, customSpaces[question.id]);
                        return (
                            <>
                                <div
                                    className="exam-answer-space"
                                    style={{ minHeight: `${effectivePx}px` }}
                                />
                                <AnswerSpaceControl
                                    effectivePx={effectivePx}
                                    isCustom={typeof customSpaces[question.id] === "number"}
                                    onChange={(px) => onChangeCustomSpace(question.id, px)}
                                    onReset={() => onChangeCustomSpace(question.id, null)}
                                />
                            </>
                        );
                    })()}
                </section>
            ))}
            {includeAnswers && (
                <section className="exam-answer-key">
                    <h2>{t.exam.answerKey}</h2>
                    {questions.map((question, index) => (
                        <div key={question.id} className="exam-question">
                            <div className="exam-question-head">
                                <span>{index + 1}.</span>
                                <span className="exam-source">{t.exam.sourceLabel}: {question.sourceShortId}</span>
                            </div>
                            {question.answerText && (
                                <div>
                                    <span className="exam-label">{t.exam.answerLabel}{t.common.colon}</span>
                                    <MarkdownRenderer content={question.answerText} />
                                </div>
                            )}
                            {question.analysis && (
                                <div>
                                    <span className="exam-label">{t.exam.analysisLabel}{t.common.colon}</span>
                                    <MarkdownRenderer content={question.analysis} />
                                </div>
                            )}
                        </div>
                    ))}
                </section>
            )}
        </div>
    );
});
