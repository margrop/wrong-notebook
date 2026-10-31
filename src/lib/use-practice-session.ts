"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { matchAnswer } from "@/lib/answer-match";
import { getApiErrorMessage } from "@/lib/error-message";
import { frontendLogger } from "@/lib/frontend-logger";
import type { ParsedQuestion } from "@/lib/ai/types";
import type { LastPractice } from "@/lib/last-practice";
import type { AppConfig, PracticeResult } from "@/types/api";

export type PracticeDifficulty = "easy" | "medium" | "hard" | "harder";

const DEFAULT_TIMEOUT = 180000;

/** AI 错误码对应的提示，未知错误用默认文案 */
const AI_ERROR_KEYS = [
    ['AI_CONNECTION_FAILED', 'aiConnectionFailed'],
    ['AI_RESPONSE_ERROR', 'aiResponseError'],
    ['AI_AUTH_ERROR', 'aiAuth'],
    ['AI_OUTPUT_TRUNCATED', 'AI_OUTPUT_TRUNCATED'],
    ['AI_UNKNOWN_ERROR', 'AI_UNKNOWN_ERROR'],
] as const;

/**
 * 举一反三练习的状态：读取上次生成的题目、生成新题、提交答案（本地比对或 AI 判题）、直接查看答案
 */
export function usePracticeSession(errorItemId: string | null) {
    const { t, language } = useLanguage();

    const [question, setQuestion] = useState<ParsedQuestion | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showAnswer, setShowAnswer] = useState(false);
    const [userAnswer, setUserAnswer] = useState("");
    const [notes, setNotes] = useState("");
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
    // AI 判题中；判定依据与失败状态用于在结果中说明
    const [grading, setGrading] = useState(false);
    const [gradeReason, setGradeReason] = useState<string | null>(null);
    const [gradeFailed, setGradeFailed] = useState(false);
    const [difficulty, setDifficulty] = useState<PracticeDifficulty>("medium");
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
            .then(setConfig)
            .catch(err => frontendLogger.error('[Practice]', 'Failed to fetch config', { error: err }));
    }, []);

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

    const timeout = config?.timeouts?.analyze || DEFAULT_TIMEOUT;

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
            frontendLogger.info('[Practice]', 'Generating question', { timeout });
            const data = await apiClient.post<ParsedQuestion & { generatedAt?: string }>("/api/practice/generate", {
                errorItemId,
                language,
                difficulty,
            }, { timeout, recoverable: true });
            setQuestion(data);
            setGeneratedDifficulty(difficulty);
            setGeneratedAt(data.generatedAt ?? null);
            setQuestionVersion(v => v + 1);
        } catch (err) {
            frontendLogger.error('[Practice]', 'Failed to generate practice question', { error: err });
            const msg = getApiErrorMessage(err) || "";
            const matched = AI_ERROR_KEYS.find(([code]) => msg.includes(code));
            const fallback = t.practice.errors?.default || "Failed to generate";
            setError((matched && t.errors?.[matched[1]]) || fallback);
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
            }, { timeout, recoverable: true });
            setIsCorrect(graded.correct);
            setGradeReason(graded.reason);
        } catch (err) {
            frontendLogger.warn('[Practice]', 'Failed to grade answer', { error: err });
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

    return {
        question, loading, loadingCached, error, generatedAt,
        difficulty, setDifficulty, generatedDifficulty, questionVersion,
        userAnswer, setUserAnswer, notes, setNotes,
        isSubmitted, isCorrect, grading, gradeReason, gradeFailed, showAnswer, suggestedResult,
        generateQuestion, submitAnswer, revealAnswer,
    };
}
