"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { PracticeResultCard } from "@/components/practice-result-card";
import { QuestionFigure } from "@/components/question-figure";
import { DifficultyPicker, DifficultySelect } from "@/components/practice/difficulty-picker";
import { GenerateButton } from "@/components/practice/generate-button";
import { PracticeFeedback } from "@/components/practice/practice-feedback";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/lib/page-title";
import { usePracticeSession } from "@/lib/use-practice-session";

export const dynamic = 'force-dynamic';

function PracticeContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const errorItemId = searchParams.get("id");
    const { t, language } = useLanguage();
    usePageTitle(t.practice.title);
    const session = usePracticeSession(errorItemId);
    const { question, loading } = session;

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

                {session.error && (
                    <div className="relative rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive" role="alert">
                        <strong className="font-bold">{t.common?.error || "Error"}: </strong>
                        <span className="block whitespace-pre-wrap"> {session.error}</span>
                    </div>
                )}

                {session.loadingCached && !question && (
                    <div className="flex justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                )}

                {!question && !session.loadingCached && (
                    <div className="flex flex-col items-center gap-4">
                        <DifficultyPicker value={session.difficulty} onChange={session.setDifficulty} />
                        <GenerateButton loading={loading} onClick={session.generateQuestion} />
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
                                    <DifficultySelect value={session.difficulty} onChange={session.setDifficulty} disabled={loading} />
                                    <GenerateButton loading={loading} onClick={session.generateQuestion} regenerate />
                                </div>
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {session.generatedAt && (
                                <p className="mb-3 text-xs text-muted-foreground">
                                    {(t.practice.lastGeneratedAt || "Generated at {time}").replace("{time}", new Date(session.generatedAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US"))}
                                </p>
                            )}
                            <MarkdownRenderer content={question.questionText} className="font-medium" />
                            <QuestionFigure svg={question.figureSvg} />
                        </CardContent>
                    </Card>

                    <Card className="border-blue-200">
                        <CardHeader>
                            <CardTitle className="text-blue-600">
                                {t.app.yourAnswer || "Your Answer"}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <Input
                                placeholder={t.app.answerPlaceholder || "Enter your answer..."}
                                value={session.userAnswer}
                                onChange={(e) => session.setUserAnswer(e.target.value)}
                                disabled={session.isSubmitted}
                                className="text-lg"
                            />
                            <Textarea
                                placeholder={t.app.notesPlaceholder || "Record your thinking process (optional)..."}
                                value={session.notes}
                                onChange={(e) => session.setNotes(e.target.value)}
                                disabled={session.isSubmitted}
                                rows={3}
                            />
                        </CardContent>
                    </Card>

                    <PracticeFeedback
                        isSubmitted={session.isSubmitted}
                        grading={session.grading}
                        isCorrect={session.isCorrect}
                        gradeFailed={session.gradeFailed}
                        gradeReason={session.gradeReason}
                        notes={session.notes}
                        canSubmit={!!session.userAnswer.trim()}
                        onSubmit={session.submitAnswer}
                        onReveal={session.revealAnswer}
                    />

                    {session.showAnswer && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                            <PracticeResultCard
                                key={session.questionVersion}
                                errorItemId={errorItemId}
                                suggested={session.suggestedResult}
                                question={question}
                                difficulty={session.generatedDifficulty}
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
