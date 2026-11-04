"use client";

import { useRouter } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { getAnalysisErrorMessage } from "@/lib/question/analysis-error";
import { confirmDialog, toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { discardImportTask, markImportTaskRead, retryImportTask } from "@/lib/import/import-task-client";
import type { ImportTaskSummary } from "@/lib/import/import-task-types";

/** 任务卡片上的操作：继续校对、查看错题、重试、丢弃 */
export function useImportTaskActions(onChanged?: () => void) {
    const { t } = useLanguage();
    const router = useRouter();

    const markRead = (task: ImportTaskSummary) => {
        if (!task.unread) return;
        markImportTaskRead(task.id).catch((error: unknown) => frontendLogger.warn('[ImportTasks]', 'Mark read failed', { error }));
    };

    return {
        openReview: (task: ImportTaskSummary) => {
            markRead(task);
            router.push(`/import-tasks/${task.id}`);
        },
        viewItem: (task: ImportTaskSummary) => {
            if (!task.errorItemId) return;
            markRead(task);
            router.push(`/error-items/${task.errorItemId}`);
        },
        markRead,
        retry: async (task: ImportTaskSummary) => {
            try {
                await retryImportTask(task.id);
                toast.info(t.importTasks.retried);
            } catch (error) {
                toast.error(getAnalysisErrorMessage(error, t));
            }
            onChanged?.();
        },
        /** 返回是否已丢弃 */
        discard: async (task: ImportTaskSummary): Promise<boolean> => {
            if (!await confirmDialog(t.importTasks.discardConfirm)) return false;
            let discarded = false;
            try {
                await discardImportTask(task.id);
                toast.success(t.importTasks.discarded);
                discarded = true;
            } catch (error) {
                toast.error(getAnalysisErrorMessage(error, t));
            }
            onChanged?.();
            return discarded;
        },
    };
}
