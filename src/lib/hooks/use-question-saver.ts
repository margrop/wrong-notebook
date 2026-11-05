"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { getApiErrorMessage, getErrorMessage } from "@/lib/error-message";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { getQuestionSaveErrorMessage } from "@/lib/question/question-save-error";

interface SavedQuestion {
    id: string;
    duplicate?: boolean;
}

/**
 * 保存题目后的统一处理：成功提示，重复题跳到原题，否则跳到所在错题本；
 * 失败时在表单中保留具体原因（每日额度由 apiClient 统一弹窗，不重复提示）。
 */
export function useQuestionSaver(logPrefix: string) {
    const { t } = useLanguage();
    const router = useRouter();
    const [saveError, setSaveError] = useState<string | null>(null);

    /** navigate 为 false 时只提示结果，由调用方决定去向（如多题批次回到批次页） */
    const run = async (request: () => Promise<SavedQuestion>, subjectId?: string | null, navigate = true): Promise<boolean> => {
        setSaveError(null);
        try {
            const result = await request();
            toast.success(result.duplicate ? t.importFlow.duplicate : t.common.messages.saveSuccess);
            if (!navigate) {
                return true;
            } else if (result.duplicate) {
                router.push(`/error-items/${result.id}`);
            } else if (subjectId) {
                router.push(`/notebooks/${subjectId}`);
            }
            return true;
        } catch (error) {
            frontendLogger.error(logPrefix, 'Save failed', { errorMessage: getApiErrorMessage(error) ?? getErrorMessage(error) });
            const message = getQuestionSaveErrorMessage(error, t);
            setSaveError(message);
            // 每日上限与未授权由 apiClient 统一提示或弹出授权窗口，这里不再重复报错
            const code = getApiErrorMessage(error);
            if (code !== 'AI_DAILY_LIMIT_EXCEEDED' && code !== 'AI_CONSENT_REQUIRED') toast.error(message);
            return false;
        }
    };

    return { saveError, setSaveError, dismissSaveError: () => setSaveError(null), run };
}
