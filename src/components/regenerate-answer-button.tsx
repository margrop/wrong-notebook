"use client";

import { useState } from "react";
import { Loader2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { toast, confirmDialog } from "@/lib/feedback";

/** 完整解答较长，等待上限与生成动画讲解一致 */
const REANSWER_TIMEOUT_MS = 10 * 60 * 1000;

interface RegenerateAnswerButtonProps {
    errorItemId: string;
    /** 生成并保存后回调新的答案和解析 */
    onDone: (updated: { answerText: string | null; analysis: string | null }) => void;
}

/** 用 AI 重新生成完整的答案和解析（覆盖前二次确认） */
export function RegenerateAnswerButton({ errorItemId, onDone }: RegenerateAnswerButtonProps) {
    const { t, language } = useLanguage();
    const [running, setRunning] = useState(false);

    const handleClick = async () => {
        if (!(await confirmDialog(t.reanswerItem.confirm))) return;
        setRunning(true);
        try {
            const updated = await apiClient.post<{ answerText: string | null; analysis: string | null }>(
                `/api/error-items/${errorItemId}/reanswer`, { language }, { timeout: REANSWER_TIMEOUT_MS, recoverable: true }
            );
            onDone(updated);
        } catch (error) {
            const code = (error as { data?: { message?: string } })?.data?.message || "";
            const mapped = (t.errors as Record<string, unknown>)[code];
            frontendLogger.error('[RegenerateAnswer]', 'Failed to regenerate answer', { code });
            toast.error(code === "NO_QUESTION_TEXT" ? t.reanswerItem.noQuestionText : typeof mapped === "string" ? mapped : t.reanswerItem.failed);
        } finally {
            setRunning(false);
        }
    };

    return (
        <Button variant="ghost" size="sm" onClick={handleClick} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <WandSparkles className="h-4 w-4 mr-1" />}
            {running ? t.reanswerItem.running : t.reanswerItem.button}
        </Button>
    );
}
