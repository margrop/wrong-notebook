"use client";

import { useState, Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, CheckCircle, Eye, Send, XCircle, ArrowLeft } from "lucide-react";
import { ParsedQuestion } from "@/lib/ai/types";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/lib/page-title";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { apiClient } from "@/lib/api-client";
import { AppConfig } from "@/types/api";
import type { PracticeResult } from "@/types/api";
import { PracticeResultCard } from "@/components/practice-result-card";
import { QuestionFigure } from "@/components/question-figure";
import { frontendLogger } from "@/lib/frontend-logger";
import type { LastPractice } from "@/lib/last-practice";
import { matchAnswer } from "@/lib/answer-match";
import { getApiErrorMessage } from "@/lib/error-message";

export const dynamic = 'force-dynamic';

function PracticeContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const errorItemId = searchParams.get("id");
    const { t, language } = useLanguage();
    usePageTitle(t.practice.title);

    const [question, setQuestion] = useState<ParsedQuestion | null>(null);
    const [loading, setLoading] = useState(false);
    const [showAnswer, setShowAnswer] = useState(false);
    const [userAnswer, setUserAnswer] = useState("");
    const [notes, setNotes] = useState("");
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
    // AI 判题中；判定依据与失败状态用于在结果中说明
    const [grading, setGrading] = useState(false);
    const [gradeReason, setGradeReason] = useState<string | null>(null);
    const [gradeFailed, setGradeFailed] = useState(false);
    // 生成当前题目时使用的难度（下拉框改动后不影响已生成题目的记录）
    const [generatedDifficulty, setGeneratedDifficulty] = useState<string>("medium");
    // 每生成一道新题递增，用于重置结果卡片
    const [questionVersion, setQuestionVersion] = useState(0);
    const [config, setConfig] = useState<AppConfig | null>(null);
    // 当前题目的生成时间；读取暂存题目期间不显示生成按钮，避免闪烁
    const [generatedAt, setGeneratedAt] = useState<string | null>(null);
    const [loadingCached, setLoadingCached] = useState(true);

    useEffect(() => {
        apiClient.get<AppConfig>("/api/settings")
            .then(data => {
                setConfig(data);
                if (data.timeouts?.analyze) {
                    frontendLogger.info('[Config]', 'Loaded timeout settings', {
                        analyze: data.timeouts.analyze
                    });
                }
            })
            .catch(err => frontendLogger.error('[Practice]', 'Failed to fetch config', { error: err }));
    }, []);

    const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard" | "harder">("medium");

    // 进入页面时先读取该错题最近一次生成的题目，有则直接显示
    useEffect(() => {
        if (!errorItemId) return;
        let cancelled = false;
        apiClient.get<{ practice: LastPractice | null }>(`/api/practice/generate?errorItemId=${encodeURIComponent(errorItemId)}`)
            .then(({ practice }) => {
                if (cancelled || !practice) return;
                setQuestion(prev => prev ?? {
                    questionText: practice.questionText,
                    answerText: practice.answerText,
                    analysis: practice.analysis,
                    subject: (practice.subject || "其他") as ParsedQuestion["subject"],
                    knowledgePoints: [],
                    wrongAnswerText: "",
                    mistakeAnalysis: "",
                    mistakeStatus: "unknown",
                    requiresImage: false,
                    figureSvg: practice.figureSvg ?? null,
                });
                setDifficulty(practice.difficulty);
                setGeneratedDifficulty(practice.difficulty);
                setGeneratedAt(practice.generatedAt);
            })
            .catch(err => frontendLogger.warn('[Practice]', 'Failed to load last practice question', {
                error: err instanceof Error ? err.message : String(err),
            }))
            .finally(() => {
                if (!cancelled) setLoadingCached(false);
            });
        return () => { cancelled = true; };
    }, [errorItemId]);

    const [error, setError] = useState<string | null>(null);

    const generateQuestion = async () => {
        if (!errorItemId) return;

        setLoading(true);
        setError(null);
        setUserAnswer("");
        setNotes("");
        setIsSubmitted(false);
        setIsCorrect(null);
        setGradeReason(null);
        setGradeFailed(false);
        setShowAnswer(false);
        try {
            const timeout = config?.timeouts?.analyze || 180000;
            frontendLogger.info('[Practice]', 'Generating question', {
                timeout
            });
            const data = await apiClient.post<ParsedQuestion & { generatedAt?: string }>("/api/practice/generate", {
                errorItemId,
                language,
                difficulty
            }, { timeout, recoverable: true });
            setQuestion(data);
            setGeneratedDifficulty(difficulty);
            setGeneratedAt(data.generatedAt ?? null);
            setQuestionVersion(v => v + 1);
        } catch (error) {
            frontendLogger.error('[Practice]', 'Failed to generate practice question', { error });
            const msg = getApiErrorMessage(error) || "";

            let errorMessage = t.practice.errors?.default || "Failed to generate";

            if (msg.includes('AI_CONNECTION_FAILED')) {
                errorMessage = t.errors?.aiConnectionFailed || errorMessage;
            } else if (msg.includes('AI_RESPONSE_ERROR')) {
                errorMessage = t.errors?.aiResponseError || errorMessage;
            } else if (msg.includes('AI_AUTH_ERROR')) {
                errorMessage = t.errors?.aiAuth || errorMessage;
            } else if (msg.includes('AI_OUTPUT_TRUNCATED')) {
                errorMessage = t.errors?.AI_OUTPUT_TRUNCATED || errorMessage;
            } else if (msg.includes('AI_UNKNOWN_ERROR')) {
                errorMessage = t.errors?.AI_UNKNOWN_ERROR || errorMessage;
            }

            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    // 本地能确定答案一致时直接判对；否则交给 AI 对照标准答案判定，失败时由用户自己选择结果
    const submitAnswer = async () => {
        if (!userAnswer.trim() || !question || !errorItemId) return;

        setIsSubmitted(true);
        if (matchAnswer(userAnswer, question.answerText)) {
            setIsCorrect(true);
            setShowAnswer(true);
            return;
        }

        setGrading(true);
        try {
            const graded = await apiClient.post<{ correct: boolean; reason: string }>("/api/practice/grade", {
                errorItemId,
                userAnswer,
                language,
            }, { timeout: config?.timeouts?.analyze || 180000, recoverable: true });
            setIsCorrect(graded.correct);
            setGradeReason(graded.reason);
        } catch (error) {
            frontendLogger.warn('[Practice]', 'Failed to grade answer', { error });
            setIsCorrect(null);
            setGradeFailed(true);
        } finally {
            setGrading(false);
            setShowAnswer(true);
        }
    };

    // 不作答直接看答案，由用户自己判定结果
    const revealAnswer = () => {
        setIsSubmitted(true);
        setIsCorrect(null);
        setShowAnswer(true);
    };

    const suggestedResult: PracticeResult | null = isCorrect === null ? null : isCorrect ? "correct" : "wrong";

    if (!errorItemId) {
        return <div className="p-8 text-center">{t.practice.invalidRequest || "Invalid Request"}</div>;
    }

    return (
        <div className="max-w-3xl mx-auto space-y-8">
            <div className="flex justify-between items-center mb-4">
                <Button variant="ghost" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {t.common?.back || "Back"}
                </Button>
            </div>
            <div className="text-center space-y-4">
                <h1 className="text-3xl font-bold">{t.practice.title}</h1>
                <p className="text-muted-foreground">
                    {t.practice.subtitle}
                </p>

                {error && (
                    <div className="relative rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive" role="alert">
                        <strong className="font-bold">{t.common?.error || "Error"}: </strong>
                        <span className="block whitespace-pre-wrap"> {error}</span>
                    </div>
                )}

                {loadingCached && !question && (
                    <div className="flex justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                )}

                {!question && !loadingCached && (
                    <div className="flex flex-col items-center gap-4">
                        <div className="flex items-center gap-2 bg-muted/50 p-2 rounded-lg">
                            <span className="text-sm font-medium text-muted-foreground">{t.practice.difficulty?.label || "Difficulty"}:</span>
                            <div className="flex gap-1">
                                {([
                                    { value: "easy", label: t.practice.difficulty?.easy || "Easy", color: "bg-green-100 text-green-700 hover:bg-green-200" },
                                    { value: "medium", label: t.practice.difficulty?.medium || "Medium", color: "bg-blue-100 text-blue-700 hover:bg-blue-200" },
                                    { value: "hard", label: t.practice.difficulty?.hard || "Hard", color: "bg-orange-100 text-orange-700 hover:bg-orange-200" },
                                    { value: "harder", label: t.practice.difficulty?.harder || "Challenge", color: "bg-red-100 text-red-700 hover:bg-red-200" }
                                ] as const).map((level) => (
                                    <button
                                        key={level.value}
                                        onClick={() => setDifficulty(level.value)}
                                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${difficulty === level.value
                                            ? level.color.replace("bg-", "bg-opacity-100 bg-").replace("text-", "ring-2 ring-offset-1 ring-")
                                            : "bg-transparent hover:bg-muted text-muted-foreground"
                                            } ${difficulty === level.value ? level.color : ''}`}
                                    >
                                        {level.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <Button size="lg" onClick={generateQuestion} disabled={loading}>
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    {t.practice.generating}
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    {t.practice.generate}
                                </>
                            )}
                        </Button>
                    </div>
                )}
            </div>

            {question && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <Card className="border-primary/50 shadow-lg">
                        <CardHeader>
                            <CardTitle className="flex justify-between items-center">
                                <span>{t.app.practiceProblem}</span>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={difficulty}
                                        onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
                                        className="h-8 text-xs border rounded px-2 bg-background"
                                        disabled={loading}
                                    >
                                        <option value="easy">{t.practice.difficulty?.easy || "Easy"}</option>
                                        <option value="medium">{t.practice.difficulty?.medium || "Medium"}</option>
                                        <option value="hard">{t.practice.difficulty?.hard || "Hard"}</option>
                                        <option value="harder">{t.practice.difficulty?.harder || "Challenge"}</option>
                                    </select>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={generateQuestion}
                                        disabled={loading}
                                    >
                                        {loading ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                {t.practice.generating}
                                            </>
                                        ) : (
                                            <>
                                                <RefreshCw className="mr-2 h-4 w-4" />
                                                {t.practice.regenerate}
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {generatedAt && (
                                <p className="mb-3 text-xs text-muted-foreground">
                                    {(t.practice.lastGeneratedAt || "Generated at {time}").replace("{time}", new Date(generatedAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US"))}
                                </p>
                            )}
                            <MarkdownRenderer content={question.questionText} className="font-medium" />
                            <QuestionFigure svg={question.figureSvg} />
                        </CardContent>
                    </Card>


                    {/* Answer Input Section */}
                    <Card className="border-blue-200">
                        <CardHeader>
                            <CardTitle className="text-blue-600">
                                {t.app.yourAnswer || "Your Answer"}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <Input
                                placeholder={t.app.answerPlaceholder || "Enter your answer..."}
                                value={userAnswer}
                                onChange={(e) => setUserAnswer(e.target.value)}
                                disabled={isSubmitted}
                                className="text-lg"
                            />
                            <Textarea
                                placeholder={t.app.notesPlaceholder || "Record your thinking process (optional)..."}
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                disabled={isSubmitted}
                                rows={3}
                            />
                        </CardContent>
                    </Card>

                    {/* Submit/Result Section */}
                    {!isSubmitted ? (
                        <div className="flex flex-col sm:flex-row justify-center gap-2">
                            <Button
                                size="lg"
                                onClick={submitAnswer}
                                disabled={!userAnswer.trim()}
                                className="w-full md:w-auto"
                            >
                                <Send className="mr-2 h-4 w-4" />
                                {t.app.submitAnswer || "Submit Answer"}
                            </Button>
                            <Button
                                size="lg"
                                variant="outline"
                                onClick={revealAnswer}
                                className="w-full md:w-auto"
                            >
                                <Eye className="mr-2 h-4 w-4" />
                                {t.practice.checkAnswer || "Check Answer"}
                            </Button>
                        </div>
                    ) : grading ? (
                        <div className="flex items-center justify-center gap-2 text-muted-foreground" role="status">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            {t.practice.grading}
                        </div>
                    ) : isCorrect === null ? (gradeFailed && (
                        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
                            {t.practice.gradeFailed}
                        </p>
                    )) : (
                        <Card className={isCorrect ? "border-green-500 bg-green-50" : "border-red-500 bg-red-50"}>
                            <CardContent className="pt-6">
                                <div className="flex items-center gap-3 mb-4">
                                    {isCorrect ? (
                                        <>
                                            <CheckCircle className="h-8 w-8 text-green-600" />
                                            <div>
                                                <h3 className="text-xl font-bold text-green-600">
                                                    {t.practice.correct || "Correct!"}
                                                </h3>
                                                <p className="text-green-700">
                                                    {t.practice.correctMessage || "Great job, keep it up!"}
                                                </p>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <XCircle className="h-8 w-8 text-red-600" />
                                            <div>
                                                <h3 className="text-xl font-bold text-red-600">
                                                    {t.practice.incorrect || "Incorrect"}
                                                </h3>
                                                <p className="text-red-700">
                                                    {t.practice.incorrectMessage || "Review the analysis and try again!"}
                                                </p>
                                            </div>
                                        </>
                                    )}
                                </div>
                                {gradeReason && (
                                    <p className="text-sm text-muted-foreground">
                                        {t.practice.aiGradeReason.replace("{reason}", gradeReason)}
                                    </p>
                                )}
                                {notes && (
                                    <div className="mt-4 p-3 bg-white rounded-lg border">
                                        <p className="text-sm font-medium text-gray-600 mb-1">
                                            {t.practice.yourNotes || "Your Notes:"}
                                        </p>
                                        <p className="text-gray-700 whitespace-pre-wrap">{notes}</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {showAnswer && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                            <PracticeResultCard
                                key={questionVersion}
                                errorItemId={errorItemId}
                                suggested={suggestedResult}
                                question={question}
                                difficulty={generatedDifficulty}
                            />
                            <Card className="bg-muted/50">
                                <CardHeader>
                                    <CardTitle className="text-green-600">{t.practice.correctAnswer}</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <MarkdownRenderer content={question.answerText} className="font-bold" />
                                </CardContent>
                            </Card>


                            <Card>
                                <CardHeader>
                                    <CardTitle>{t.practice.detailedAnalysis}</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <MarkdownRenderer content={question.analysis} />
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default function PracticePage() {
    return (
        <main className="min-h-screen px-4 py-6 md:px-8 md:py-8">
            <Suspense fallback={
                <div className="flex justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            }>
                <PracticeContent />
            </Suspense>
        </main>
    );
}
