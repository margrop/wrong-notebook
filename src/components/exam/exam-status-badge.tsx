"use client";

import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ExamStatus } from "@/types/api";

/** 徽章显示的状态：生成状态之外，录入过结果的试卷显示为「已完成」 */
export type ExamDisplayStatus = ExamStatus | "completed";

const STATUS_CLASS: Record<ExamDisplayStatus, string> = {
    generating: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900",
    ready: "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900",
    partial: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900",
    failed: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900",
    completed: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900",
};

/** 至少录入过一次结果的已生成（含部分失败）试卷显示为已完成 */
export function getExamDisplayStatus(status: ExamStatus, recorded: boolean): ExamDisplayStatus {
    return recorded && (status === "ready" || status === "partial") ? "completed" : status;
}

interface ExamStatusBadgeProps {
    status: ExamStatus;
    /** 是否至少录入过一次结果 */
    recorded: boolean;
}

export function ExamStatusBadge({ status, recorded }: ExamStatusBadgeProps) {
    const { t } = useLanguage();
    const displayStatus = getExamDisplayStatus(status, recorded);
    return <Badge variant="outline" className={STATUS_CLASS[displayStatus]}>{t.exam.status[displayStatus]}</Badge>;
}
