"use client";

import { forwardRef } from "react";
import { FigureScaleEditor } from "@/components/error-detail/figure-scale-editor";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { AnswerSpaceControl } from "@/components/print-preview/answer-space-control";
import { PrintQuestionText } from "@/components/print-preview/print-question-text";
import { useLanguage } from "@/contexts/LanguageContext";
import { resolveQuestionAnswerSpacePx } from "@/lib/exam/exam-answer-space";
import type { AnswerSpaceMode } from "@/lib/exam/exam-answer-space";
import { formatExamScore, summarizeExamScores } from "@/lib/exam/exam-score";
import { groupExamQuestions } from "@/lib/exam/exam-sections";
import type { ExamSection, ExamSectionItem } from "@/lib/exam/exam-sections";
import type { FigureAlign } from "@/lib/figure-scale";
import type { ExamPaperDetail, ExamQuestionDetail } from "@/types/api";

interface ExamPrintSheetProps {
    paper: ExamPaperDetail;
    includeAnswers: boolean;
    answerSpace: AnswerSpaceMode;
    customSpaces: Record<string, number>;
    uniformPreview: { scale: number | null; align: FigureAlign | null };
    onSaveFigureScale: (questionId: string, figureScale: number, figureAlign: FigureAlign) => Promise<void>;
    onChangeCustomSpace: (questionId: string, px: number | null) => void;
}

interface ExamPrintQuestionProps {
    question: ExamQuestionDetail;
    /** 显示题号：不分组时为组内序号 + 1，分组时为全卷连续编号 */
    displayNumber: number;
    scoreUnit: string;
    answerSpace: AnswerSpaceMode;
    customSpaces: Record<string, number>;
    uniformPreview: { scale: number | null; align: FigureAlign | null };
    onSaveFigureScale: (questionId: string, figureScale: number, figureAlign: FigureAlign) => Promise<void>;
    onChangeCustomSpace: (questionId: string, px: number | null) => void;
}

/** 打印中的一道题目：题号与分值行、题干、配图与留白 */
function ExamPrintQuestion({
    question,
    displayNumber,
    scoreUnit,
    answerSpace,
    customSpaces,
    uniformPreview,
    onSaveFigureScale,
    onChangeCustomSpace,
}: ExamPrintQuestionProps) {
    const { t } = useLanguage();
    return (
        <section className="exam-question">
            <div className="exam-question-head">
                <span>
                    {displayNumber}.
                    {typeof question.score === 'number' && `（${formatExamScore(question.score)} ${scoreUnit}）`}
                </span>
                <span className="exam-source">{t.exam.sourceLabel}: {question.sourceShortId}</span>
            </div>
            <PrintQuestionText content={question.questionText!} />
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
    );
}

/** 分组打印时的大题标题行：题型名 + 题数与分值小计 */
function ExamPrintSectionHeader({ section }: { section: ExamSection<ExamQuestionDetail> }) {
    const { t } = useLanguage();
    const summary = section.scoreTotal !== null
        ? t.exam.sectionSummaryScored
            .replace("{count}", String(section.count))
            .replace("{total}", String(section.scoreTotal))
        : t.exam.sectionSummary.replace("{count}", String(section.count));
    return (
        <div className="exam-section-head">
            <h2>{section.title}</h2>
            <span className="exam-section-summary">
                {summary}
                {section.scoreTotal !== null && section.unscored > 0 && (
                    <span>（{t.exam.sectionSummaryUnscored.replace("{count}", String(section.unscored))}）</span>
                )}
            </span>
        </div>
    );
}

/** 打印预览中的试卷正文：标题、满分行、各题（可按题型分大题）与可选答案页。 */
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
    // 按题型分大题：开启且全卷均为就绪题目时才分组（与非分组打印的过滤口径一致）
    const sections = paper.groupByType ? groupExamQuestions(questions, language) : null;

    const renderQuestion = (question: ExamQuestionDetail, displayNumber: number) => (
        <ExamPrintQuestion
            key={question.id}
            question={question}
            displayNumber={displayNumber}
            scoreUnit={scoreUnit}
            answerSpace={answerSpace}
            customSpaces={customSpaces}
            uniformPreview={uniformPreview}
            onSaveFigureScale={onSaveFigureScale}
            onChangeCustomSpace={onChangeCustomSpace}
        />
    );

    // 答案页同样按大题分组，题号与正文一致
    const renderAnswerKey = (items: ExamSectionItem<ExamQuestionDetail>[]) => (
        items.map((item) => (
            <div key={item.question.id} className="exam-question">
                <div className="exam-question-head">
                    <span>{item.displayNumber}.</span>
                    <span className="exam-source">{t.exam.sourceLabel}: {item.question.sourceShortId}</span>
                </div>
                {item.question.answerText && (
                    <div>
                        <span className="exam-label">{t.exam.answerLabel}{t.common.colon}</span>
                        <MarkdownRenderer content={item.question.answerText} />
                    </div>
                )}
                {item.question.analysis && (
                    <div>
                        <span className="exam-label">{t.exam.analysisLabel}{t.common.colon}</span>
                        <MarkdownRenderer content={item.question.analysis} />
                    </div>
                )}
            </div>
        ))
    );

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
            {sections ? (
                sections.map((section) => (
                    <div key={section.title}>
                        <ExamPrintSectionHeader section={section} />
                        {section.items.map((item) => renderQuestion(item.question, item.displayNumber))}
                    </div>
                ))
            ) : (
                questions.map((question, index) => renderQuestion(question, index + 1))
            )}
            {includeAnswers && (
                <section className="exam-answer-key">
                    <h2>{t.exam.answerKey}</h2>
                    {sections ? (
                        sections.map((section) => (
                            <div key={section.title}>
                                <ExamPrintSectionHeader section={section} />
                                {renderAnswerKey(section.items)}
                            </div>
                        ))
                    ) : (
                        renderAnswerKey(questions.map((question, index) => ({ question, displayNumber: index + 1 })))
                    )}
                </section>
            )}
        </div>
    );
});
