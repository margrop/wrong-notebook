"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Loader2, ScanText } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";
import { useImportTaskList } from "@/lib/hooks/use-import-tasks";
import { cn } from "@/lib/utils";

interface ImportTasksIndicatorProps {
    className?: string;
}

/**
 * 页头的「识别任务」入口：带文字，执行中显示数量与转圈，有新结果时显示未读数。
 * 回到前台立即刷新；本页面会话中有任务结束时提示一次。
 */
export function ImportTasksIndicator({ className }: ImportTasksIndicatorProps) {
    const { t } = useLanguage();
    const { data } = useImportTaskList();
    const activeIds = useRef<Set<string> | null>(null);

    useEffect(() => {
        if (!data) return;
        // 单独的任务与多题批次（分题或逐题解析）结束时提示一次，不切换页面
        const nowActive = new Set([
            ...data.tasks.filter((task) => task.status === "analyzing" || task.status === "saving").map((task) => task.id),
            ...(data.batches ?? []).filter((batch) => batch.phase === "splitting" || batch.phase === "processing").map((batch) => `batch:${batch.id}`),
        ]);
        const unread = new Set([
            ...data.tasks.filter((task) => task.unread).map((task) => task.id),
            ...(data.batches ?? []).filter((batch) => batch.unread).map((batch) => `batch:${batch.id}`),
        ]);
        const previous = activeIds.current;
        if (previous && [...previous].some((id) => !nowActive.has(id) && unread.has(id))) {
            toast.info(t.importTasks.finishedToast);
        }
        activeIds.current = nowActive;
    }, [data, t.importTasks.finishedToast]);

    if (!data || (data.tasks.length === 0 && !data.batches?.length)) return null;
    const { activeCount, unreadCount } = data;
    const label = activeCount > 0
        ? t.importTasks.entryActive.replace("{count}", String(activeCount))
        : t.importTasks.entry;

    return (
        <Link
            href="/import-tasks"
            className={cn(
                "relative flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors hover:bg-muted",
                unreadCount > 0 ? "border-primary/50 text-primary" : "text-muted-foreground",
                className,
            )}
            data-testid="import-tasks-entry"
            aria-label={unreadCount > 0 ? `${label} · ${t.importTasks.entryUnread.replace("{count}", String(unreadCount))}` : label}
        >
            {activeCount > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
            <span className="whitespace-nowrap">{label}</span>
            {unreadCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs text-white" data-testid="import-tasks-unread">
                    {unreadCount}
                </span>
            )}
        </Link>
    );
}
