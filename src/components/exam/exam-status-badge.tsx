"use client";

import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ExamStatus } from "@/types/api";

/** 徽章显示的状态：生成状态之外，全部可批改题目都录入过结果时显示为「已完成」 */
export type ExamDisplayStatus = ExamStatus | "completed";

const STATUS_CLASS: Record<ExamDisplayStatus, string> = {
    generating: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900",
    ready: "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900",
    partial: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900",
    failed: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900",
    completed: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900",
};

/** 全部可批改题目（已生成的题）都录入过结果时显示为已完成；生成中与生成失败保持原状态 */
export function getExamDisplayStatus(status: ExamStatus, gradedCount: number, totalCount: number): ExamDisplayStatus {
    return (status === "ready" || status === "partial") && totalCount > 0 && gradedCount >= totalCount
        ? "completed"
        : status;
}

interface ExamStatusBadgeProps {
    status: ExamStatus;
    /** 已录入结果的题目数（只计已生成的题） */
    gradedCount: number;
    /** 可批改的题目总数（已生成的题数） */
    totalCount: number;
}

export function ExamStatusBadge({ status, gradedCount, totalCount }: ExamStatusBadgeProps) {
    const { t } = useLanguage();
    const displayStatus = getExamDisplayStatus(status, gradedCount, totalCount);
    return <Badge variant="outline" className={STATUS_CLASS[displayStatus]}>{t.exam.status[displayStatus]}</Badge>;
}
