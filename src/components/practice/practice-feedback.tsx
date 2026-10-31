"use client";

import { CheckCircle, Eye, Loader2, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";

interface PracticeFeedbackProps {
    isSubmitted: boolean;
    grading: boolean;
    isCorrect: boolean | null;
    gradeFailed: boolean;
    gradeReason: string | null;
    notes: string;
    canSubmit: boolean;
    onSubmit: () => void;
    onReveal: () => void;
}

/** 作答后的区域：未提交时显示提交/看答案按钮，判题中显示进度，判题后显示对错与 AI 判定依据 */
export function PracticeFeedback({ isSubmitted, grading, isCorrect, gradeFailed, gradeReason, notes, canSubmit, onSubmit, onReveal }: PracticeFeedbackProps) {
    const { t } = useLanguage();

    if (!isSubmitted) {
        return (
            <div className="flex flex-col sm:flex-row justify-center gap-2">
                <Button size="lg" onClick={onSubmit} disabled={!canSubmit} className="w-full md:w-auto">
                    <Send className="mr-2 h-4 w-4" />
                    {t.app.submitAnswer || "Submit Answer"}
                </Button>
                <Button size="lg" variant="outline" onClick={onReveal} className="w-full md:w-auto">
                    <Eye className="mr-2 h-4 w-4" />
                    {t.practice.checkAnswer || "Check Answer"}
                </Button>
            </div>
        );
    }

    if (grading) {
        return (
            <div className="flex items-center justify-center gap-2 text-muted-foreground" role="status">
                <Loader2 className="h-5 w-5 animate-spin" />
                {t.practice.grading}
            </div>
        );
    }

    if (isCorrect === null) {
        return gradeFailed ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
                {t.practice.gradeFailed}
            </p>
        ) : null;
    }

    const Icon = isCorrect ? CheckCircle : XCircle;
    const tone = isCorrect ? "green" : "red";
    return (
        <Card className={isCorrect ? "border-green-500 bg-green-50" : "border-red-500 bg-red-50"}>
            <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-4">
                    <Icon className={`h-8 w-8 ${tone === "green" ? "text-green-600" : "text-red-600"}`} />
                    <div>
                        <h3 className={`text-xl font-bold ${tone === "green" ? "text-green-600" : "text-red-600"}`}>
                            {isCorrect ? (t.practice.correct || "Correct!") : (t.practice.incorrect || "Incorrect")}
                        </h3>
                        <p className={tone === "green" ? "text-green-700" : "text-red-700"}>
                            {isCorrect
                                ? (t.practice.correctMessage || "Great job, keep it up!")
                                : (t.practice.incorrectMessage || "Review the analysis and try again!")}
                        </p>
                    </div>
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
    );
}
