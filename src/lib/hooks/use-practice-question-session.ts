"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { matchAnswer } from "@/lib/answer-match";
import { getApiErrorMessage } from "@/lib/error-message";
import { frontendLogger } from "@/lib/frontend-logger";
import { toast } from "@/lib/feedback";
import type { ParsedQuestion } from "@/lib/ai/types";
import type { PracticeQuestionDetail, PracticeResult } from "@/types/api";

const DEFAULT_TIMEOUT = 180000;

const SUBJECTS = ["数学", "科学", "物理", "化学", "生物", "英语", "语文", "历史", "地理", "政治", "其他"] as const;


/**
 * 历史练习题的重复作答状态：读取已生成的题目与作答记录，判题与保存均不重新调用生成接口。
 */
export function usePracticeQuestionSession(questionId: string) {
    const { t, language } = useLanguage();
    const [detail, setDetail] = useState<PracticeQuestionDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showAnswer, setShowAnswer] = useState(false);
    const [userAnswer, setUserAnswer] = useState("");
    const [notes, setNotes] = useState("");
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
    const [grading, setGrading] = useState(false);
    const [gradeReason, setGradeReason] = useState<string | null>(null);
    const [gradeFailed, setGradeFailed] = useState(false);

    const reload = async () => {
        try {
            const data = await apiClient.get<PracticeQuestionDetail>(`/api/practice/questions/${encodeURIComponent(questionId)}`);
            setDetail(data);
        } catch (err) {
            setError(getApiErrorMessage(err) || t.practice.errors?.default || "Failed to load");
        }
    };

    useEffect(() => {
        let cancelled = false;
        apiClient.get<PracticeQuestionDetail>(`/api/practice/questions/${encodeURIComponent(questionId)}`)
            .then((data) => { if (!cancelled) setDetail(data); })
            .catch((err) => { if (!cancelled) setError(getApiErrorMessage(err) || t.practice.errors?.default || "Failed to load"); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [questionId, t.practice.errors?.default]);

    const question: ParsedQuestion | null = detail ? {
        questionText: detail.questionText,
        answerText: detail.answerText,
        analysis: detail.analysis,
        subject: (SUBJECTS as readonly string[]).includes(detail.subject ?? "") ? detail.subject as ParsedQuestion["subject"] : "其他",
        knowledgePoints: [],
        wrongAnswerText: "",
        mistakeAnalysis: "",
        mistakeStatus: "unknown",
        requiresImage: false,
        figureSvg: detail.figureSvg,
    } : null;

    const submitAnswer = async () => {
        if (!userAnswer.trim() || !question || !detail) return;

        setIsSubmitted(true);
        if (matchAnswer(userAnswer, question.answerText, question.questionText)) {
            setIsCorrect(true);
            setShowAnswer(true);
            return;
        }

        setGrading(true);
        try {
            const graded = await apiClient.post<{ correct: boolean; reason: string }>("/api/practice/grade", {
                practiceQuestionId: detail.id,
                errorItemId: detail.errorItem?.id,
                userAnswer,
                language,
            }, { timeout: DEFAULT_TIMEOUT, recoverable: true });
            setIsCorrect(graded.correct);
            setGradeReason(graded.reason);
        } catch (err) {
            frontendLogger.warn('[Practice]', 'Failed to grade history question', { error: err });
            setIsCorrect(null);
            setGradeFailed(true);
        } finally {
            setGrading(false);
            setShowAnswer(true);
        }
    };

    const revealAnswer = () => {
        setIsSubmitted(true);
        setIsCorrect(null);
        setShowAnswer(true);
    };

    const suggestedResult: PracticeResult | null = isCorrect === null ? null : isCorrect ? "correct" : "wrong";

    return {
        detail, question, loading, error,
        userAnswer, setUserAnswer, notes, setNotes,
        isSubmitted, isCorrect, grading, gradeReason, gradeFailed, showAnswer, suggestedResult,
        submitAnswer, revealAnswer, reload,
        onSaved: async () => { toast.success(t.mastery.resultSaved); await reload(); },
    };
}
