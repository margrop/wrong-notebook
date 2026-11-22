"use client";

import Link from "next/link";
import { ArrowLeft, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { QuestionFigure } from "@/components/question-figure";
import { PracticeFeedback } from "@/components/practice/practice-feedback";
import { PracticeResultCard } from "@/components/practice-result-card";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePracticeQuestionSession } from "@/lib/hooks/use-practice-question-session";

interface PracticeQuestionDetailViewProps {
    questionId: string;
}

/** 历史练习题的重复作答：题目与答案来自已保存的生成题，不重新调用 AI 出题 */
export function PracticeQuestionDetailView({ questionId }: PracticeQuestionDetailViewProps) {
    const { t, language } = useLanguage();
    const session = usePracticeQuestionSession(questionId);
    const { detail, question } = session;

    if (session.loading) {
        return (
            <div className="flex justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
        );
    }
    if (session.error || !question || !detail) {
        return <p className="text-sm text-destructive">{session.error || (t.practice.history?.notFound || "Practice question not found")}</p>;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="ghost" asChild>
                    <Link href="/practice"><ArrowLeft className="mr-2 h-4 w-4" />{t.practice.history?.back || "Back to practice history"}</Link>
                </Button>
                {detail.errorItem && (
                    <Link href={`/error-items/${detail.errorItem.id}`} className="text-sm text-primary hover:underline">
                        {t.practice.history?.viewOriginal || "View original question"}
                    </Link>
                )}
            </div>

            <Card className="border-primary/50 shadow-lg">
                <CardHeader>
                    <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                        <span>{t.app.practiceProblem}</span>
                        <span className="text-xs font-normal text-muted-foreground">
                            {detail.difficulty ? t.practice.difficulty[detail.difficulty as keyof typeof t.practice.difficulty] ?? detail.difficulty : t.practice.difficulty.Unknown}
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="mb-3 text-xs text-muted-foreground">
                        {(t.practice.history?.generatedAt || "Generated at {time}").replace("{time}", new Date(detail.generatedAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US"))}
                    </p>
                    <MarkdownRenderer content={question.questionText} className="font-medium" />
                    <QuestionFigure svg={question.figureSvg} />
                </CardContent>
            </Card>

            <Card className="border-blue-200">
                <CardHeader>
                    <CardTitle className="text-blue-600">{t.app.yourAnswer || "Your Answer"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Input
                        placeholder={t.app.answerPlaceholder || "Enter your answer..."}
                        value={session.userAnswer}
                        onChange={(event) => session.setUserAnswer(event.target.value)}
                        disabled={session.isSubmitted}
                        className="text-lg"
                    />
                    <Textarea
                        placeholder={t.app.notesPlaceholder || "Record your thinking process (optional)..."}
                        value={session.notes}
                        onChange={(event) => session.setNotes(event.target.value)}
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
                <div className="space-y-6">
                    <PracticeResultCard
                        key={detail.attempts.length}
                        errorItemId={detail.errorItem?.id}
                        practiceQuestionId={detail.id}
                        suggested={session.suggestedResult}
                        question={question}
                        difficulty={detail.difficulty ?? "medium"}
                        onSaved={session.onSaved}
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

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <History className="h-4 w-4" />
                                {t.practice.history?.attemptsTitle || "Attempt history"}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {detail.attempts.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{t.practice.history?.noAttempts || "No attempts recorded yet."}</p>
                            ) : (
                                <ul className="space-y-1 text-sm">
                                    {detail.attempts.map((attempt) => (
                                        <li key={attempt.id} className="flex items-center justify-between gap-3 border-b py-1 last:border-0">
                                            <span>{t.mastery.results[attempt.result as keyof typeof t.mastery.results] ?? (attempt.isCorrect ? t.mastery.results.correct : t.mastery.results.wrong)}</span>
                                            <span className="text-xs text-muted-foreground">{new Date(attempt.createdAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
