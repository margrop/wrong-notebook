"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BackButton } from "@/components/ui/back-button";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { QuestionFigure } from "@/components/question-figure";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/lib/page-title";
import { apiClient } from "@/lib/api-client";
import { EXAM_PRINT_CSS, buildExamHtmlDocument, examFileName } from "@/lib/exam-print";
import {
    ANSWER_SPACE_STORAGE_KEY,
    DEFAULT_ANSWER_SPACE_MODE,
    getAnswerSpacePx,
    isAnswerSpaceMode,
} from "@/lib/exam-answer-space";
import type { AnswerSpaceMode } from "@/lib/exam-answer-space";
import type { ExamPaperDetail } from "@/types/api";

export default function ExamPrintPage() {
    const params = useParams();
    const { t, language } = useLanguage();
    const [paper, setPaper] = useState<ExamPaperDetail | null>(null);
    usePageTitle(t.exam.title, paper?.title, t.pageTitle.examPrint);
    const [includeAnswers, setIncludeAnswers] = useState(true);
    const [answerSpace, setAnswerSpace] = useState<AnswerSpaceMode>(DEFAULT_ANSWER_SPACE_MODE);
    const sheetRef = useRef<HTMLDivElement>(null);

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

    const downloadHtml = () => {
        if (!sheetRef.current) return;
        const html = buildExamHtmlDocument(paper.title, sheetRef.current.outerHTML, language === "en" ? "en" : "zh-CN");
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
                    </div>
                    <div className="flex gap-2 sm:ml-auto">
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
                    {questions.length < paper.questions.length && (
                        <p className="w-full text-xs text-muted-foreground">{t.exam.notReadyHint}</p>
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
                        <QuestionFigure svg={question.figureSvg} />
                        <div
                            className="exam-answer-space"
                            style={{ minHeight: `${getAnswerSpacePx(answerSpace, question.questionText!)}px` }}
                        />
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
