"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BackButton } from "@/components/ui/back-button";
import { FigureScaleEditor } from "@/components/error-detail/figure-scale-editor";
import { ExamFigureScaleBar } from "@/components/exam/exam-figure-scale-bar";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { AnswerSpaceControl } from "@/components/print-preview/answer-space-control";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/lib/page-title";
import { apiClient } from "@/lib/api-client";
import { EXAM_PRINT_CSS, buildExamHtmlDocument, examFileName } from "@/lib/exam/exam-print";
import {
    ANSWER_SPACE_STORAGE_KEY,
    DEFAULT_ANSWER_SPACE_MODE,
    isAnswerSpaceMode,
    resolveQuestionAnswerSpacePx,
} from "@/lib/exam/exam-answer-space";
import type { AnswerSpaceMode } from "@/lib/exam/exam-answer-space";
import { useSavedAnswerSpaces } from "@/lib/hooks/use-saved-answer-spaces";
import type { AnswerSpaceChange } from "@/lib/hooks/use-saved-answer-spaces";
import type { FigureAlign } from "@/lib/figure-scale";
import type { ExamPaperDetail } from "@/types/api";

const EMPTY_QUESTIONS: ExamPaperDetail["questions"] = [];

export default function ExamPrintPage() {
    const params = useParams();
    const { t, language } = useLanguage();
    const [paper, setPaper] = useState<ExamPaperDetail | null>(null);
    usePageTitle(t.exam.title, paper?.title, t.pageTitle.examPrint);
    const [includeAnswers, setIncludeAnswers] = useState(true);
    const [answerSpace, setAnswerSpace] = useState<AnswerSpaceMode>(DEFAULT_ANSWER_SPACE_MODE);
    const [uniformPreview, setUniformPreview] = useState<{ scale: number | null; align: FigureAlign | null }>({ scale: null, align: null });
    const sheetRef = useRef<HTMLDivElement>(null);

    const paperId = paper?.id;
    const saveAnswerSpaces = useCallback(async (changes: AnswerSpaceChange[]) => {
        if (!paperId) return;
        // 全部恢复默认时一次清除整卷，否则逐题保存
        if (changes.length > 1 && changes.every((change) => change.answerSpacePx === null)) {
            await apiClient.patch(`/api/exams/${paperId}`, { answerSpacePx: null });
            return;
        }
        await Promise.all(changes.map(({ id, answerSpacePx }) =>
            apiClient.patch(`/api/exams/${paperId}`, { questionId: id, answerSpacePx })));
    }, [paperId]);
    const {
        customSpaces,
        setSpace: setQuestionCustomSpace,
        resetAll: resetAllCustomSpaces,
        saveFailed: answerSpaceSaveFailed,
    } = useSavedAnswerSpaces(paper?.questions ?? EMPTY_QUESTIONS, saveAnswerSpaces);

    useEffect(() => {
        let saved: string | null = null;
        try {
            saved = localStorage.getItem(ANSWER_SPACE_STORAGE_KEY);
        } catch {
            // 无法读取本地存储时使用默认模式
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 本地存储只能在客户端挂载后读取，避免与服务端渲染结果不一致
        if (isAnswerSpaceMode(saved)) setAnswerSpace(saved);
    }, []);

    const changeAnswerSpace = (value: string) => {
        if (!isAnswerSpaceMode(value)) return;
        setAnswerSpace(value);
        try {
            localStorage.setItem(ANSWER_SPACE_STORAGE_KEY, value);
        } catch {
            // 无痕模式等无法写入时只在本次生效
        }
    };

    useEffect(() => {
        apiClient.get<ExamPaperDetail>(`/api/exams/${params.id}`)
            .then(setPaper)
            .catch(() => setPaper(null));
    }, [params.id]);

    if (!paper) return <div className="p-8 text-center">{t.common.loading}</div>;

    const questions = paper.questions.filter((question) => question.status === "ready" && question.questionText);
    const figureQuestions = questions.filter((question) => Boolean(question.figureSvg));

    const saveQuestionFigureScale = async (questionId: string, figureScale: number, figureAlign: FigureAlign) => {
        await apiClient.patch(`/api/exams/${paper.id}`, { questionId, figureScale, figureAlign });
        setPaper((prev) => (prev ? {
            ...prev,
            questions: prev.questions.map((question) => (question.id === questionId ? { ...question, figureScale, figureAlign } : question)),
        } : prev));
    };

    const saveUniformFigureScale = async (patch: { figureScale?: number; figureAlign?: FigureAlign }) => {
        await apiClient.patch(`/api/exams/${paper.id}`, patch);
        setPaper((prev) => (prev ? {
            ...prev,
            questions: prev.questions.map((question) => ({ ...question, ...patch })),
        } : prev));
    };

    const downloadHtml = () => {
        if (!sheetRef.current) return;
        const clone = sheetRef.current.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(".figure-scale-editor-controls, .answer-space-controls, .print\\:hidden").forEach((element) => element.remove());
        const html = buildExamHtmlDocument(paper.title, clone.outerHTML, language === "en" ? "en" : "zh-CN");
        const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = examFileName(paper.title);
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <main className="min-h-screen bg-white">
            <style>{EXAM_PRINT_CSS}</style>
            <div className="print:hidden sticky top-0 z-10 border-b bg-background p-3 shadow-sm">
                <div className="max-w-4xl mx-auto flex flex-wrap items-center gap-3">
                    <BackButton fallbackUrl={`/exams/${paper.id}`} />
                    <span className="font-semibold">{t.exam.printTitle}</span>
                    <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={includeAnswers} onCheckedChange={(value) => setIncludeAnswers(value === true)} />
                        {t.exam.includeAnswers}
                    </label>
                    <div className="flex items-center gap-2 text-sm">
                        <span className="shrink-0">{t.exam.answerSpace}</span>
                        <Select value={answerSpace} onValueChange={changeAnswerSpace}>
                            <SelectTrigger className="h-8 w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="auto">{t.exam.answerSpaceAuto}</SelectItem>
                                <SelectItem value="none">{t.exam.answerSpaceNone}</SelectItem>
                                <SelectItem value="small">{t.exam.answerSpaceSmall}</SelectItem>
                                <SelectItem value="medium">{t.exam.answerSpaceMedium}</SelectItem>
                                <SelectItem value="large">{t.exam.answerSpaceLarge}</SelectItem>
                            </SelectContent>
                        </Select>
                        {Object.keys(customSpaces).length > 0 && (
                            <Button type="button" variant="ghost" size="sm" onClick={resetAllCustomSpaces}>
                                {t.exam.resetAllQuestionAnswerSpaces}
                            </Button>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2 sm:ml-auto">
                        <Button variant="outline" size="sm" onClick={downloadHtml}>
                            <Download className="mr-2 h-4 w-4" />
                            {t.exam.downloadHtml}
                        </Button>
                        <Button size="sm" onClick={() => window.print()}>
                            <Printer className="mr-2 h-4 w-4" />
                            {t.exam.printNow}
                        </Button>
                    </div>
                    {answerSpace === "auto" && (
                        <p className="w-full text-xs text-muted-foreground">{t.exam.answerSpaceAutoHint}</p>
                    )}
                    {answerSpaceSaveFailed && (
                        <p className="w-full text-xs text-destructive">{t.exam.answerSpaceSaveFailed}</p>
                    )}
                    {questions.length < paper.questions.length && (
                        <p className="w-full text-xs text-muted-foreground">{t.exam.notReadyHint}</p>
                    )}
                    {figureQuestions.length > 0 && (
                        <ExamFigureScaleBar
                            scales={figureQuestions.map((question) => question.figureScale)}
                            aligns={figureQuestions.map((question) => question.figureAlign)}
                            onPreviewChange={setUniformPreview}
                            onSave={saveUniformFigureScale}
                        />
                    )}
                </div>
            </div>

            <div ref={sheetRef} className="exam-sheet">
                <h1>{paper.title}</h1>
                <div className="exam-meta">
                    <span>{t.exam.nameLine}{t.common.colon}________</span>
                    <span>{t.exam.dateLine}{t.common.colon}________</span>
                    <span>{t.exam.scoreLine}{t.common.colon}________</span>
                </div>
                {questions.map((question, index) => (
                    <section key={question.id} className="exam-question">
                        <div className="exam-question-head">
                            <span>{index + 1}.</span>
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
                            onSave={(figureScale, figureAlign) => saveQuestionFigureScale(question.id, figureScale, figureAlign)}
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
                                        onChange={(px) => setQuestionCustomSpace(question.id, px)}
                                        onReset={() => setQuestionCustomSpace(question.id, null)}
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
        </main>
    );
}
