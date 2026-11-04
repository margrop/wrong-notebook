"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { ApiError } from "@/lib/api-client";
import { useRunningTask } from "@/lib/hooks/use-running-task";
import { frontendLogger } from "@/lib/frontend-logger";
import { toast, confirmDialog } from "@/lib/feedback";
import type { ExamMode, ExamQuestionDetail } from "@/types/api";

/** 生成题目或完整解答较长，等待上限与重新解答一致 */
const REGENERATE_TIMEOUT_MS = 10 * 60 * 1000;

type RegenerateMode = "question" | "answer";
type RegeneratedFields = Pick<ExamQuestionDetail, "status" | "questionText" | "answerText" | "analysis" | "figureSvg" | "error">;

interface ExamQuestionRegenerateProps {
    paperId: string;
    paperMode?: ExamMode;
    question: ExamQuestionDetail;
    onDone: (updated: RegeneratedFields) => void;
}

/** 单题重新生成：未录入结果时可重新生成题目和解答，录入后只能重新生成解答。原题直出模式隐藏「换一道题」。 */
export function ExamQuestionRegenerate({ paperId, paperMode, question, onDone }: ExamQuestionRegenerateProps) {
    const { t, language } = useLanguage();
    const [running, setRunning] = useState<RegenerateMode | null>(null);
    const target = `exam-question:${question.id}:regenerate`;
    const { running: bgRunning, refresh } = useRunningTask(target);
    // 任务结束后（running 从任务对象变为 null）重新加载页面数据，让服务端已写入的结果显示出来
    const prevBgRunning = useRef(false);
    useEffect(() => {
        if (bgRunning) {
            prevBgRunning.current = true;
            return;
        }
        if (prevBgRunning.current) {
            prevBgRunning.current = false;
            onDone({} as RegeneratedFields);
        }
    }, [bgRunning, onDone]);

    const canRegenerateQuestion = paperMode !== 'original' && question.attempts.length === 0 && !!question.errorItemId && question.status !== "pending";
    const canRegenerateAnswer = question.status === "ready" && !!question.questionText?.trim();
    if (!canRegenerateQuestion && !canRegenerateAnswer) return null;

    const run = async (mode: RegenerateMode) => {
        const confirmText = mode === "question" ? t.exam.regenerateQuestionConfirm : t.exam.regenerateAnswerConfirm;
        if (!(await confirmDialog(confirmText))) return;
        setRunning(mode);
        try {
            const updated = await apiClient.post<RegeneratedFields>(
                `/api/exams/${paperId}/questions/${question.id}/regenerate`, { mode, language }, { timeout: REGENERATE_TIMEOUT_MS, recoverable: true }
            );
            onDone(updated);
        } catch (error) {
            if (error instanceof ApiError && error.status === 409 && (error.data as { code?: string })?.code === "TASK_ALREADY_RUNNING") {
                toast.info(t.errors.TASK_ALREADY_RUNNING);
                await refresh();
            } else {
                const code = (error as { data?: { message?: string } })?.data?.message || "";
                const mapped = (t.errors as Record<string, unknown>)[code];
                frontendLogger.error('[ExamRegenerate]', 'Failed to regenerate exam question', { mode, code });
                toast.error(code === "HAS_RESULTS" ? t.exam.regenerateHasResults : typeof mapped === "string" ? mapped : t.exam.regenerateFailed);
            }
        } finally {
            setRunning(null);
        }
    };

    const anyRunning = running !== null || !!bgRunning;

    return (
        <div className="flex flex-wrap gap-1">
            {canRegenerateQuestion && (
                <Button variant="ghost" size="sm" onClick={() => run("question")} disabled={anyRunning}>
                    {anyRunning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                    {anyRunning ? t.exam.regenerating : t.exam.regenerateQuestion}
                </Button>
            )}
            {canRegenerateAnswer && (
                <Button variant="ghost" size="sm" onClick={() => run("answer")} disabled={anyRunning}>
                    {anyRunning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-1 h-4 w-4" />}
                    {anyRunning ? t.exam.regenerating : t.exam.regenerateAnswer}
                </Button>
            )}
        </div>
    );
}
