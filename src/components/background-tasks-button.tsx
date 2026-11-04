"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { CheckCircle2, ListTodo, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { apiClient } from "@/lib/api-client";
import { backgroundTaskStore } from "@/lib/background-task-store";
import { formatDateTime } from "@/lib/date-time";
import type { BackgroundTask } from "@/lib/background-tasks";

// 登录、注册和打印页面不显示
const HIDDEN_PATHS = [/^\/login/, /^\/register/, /^\/print-preview/, /^\/exams\/[^/]+\/print/];

function formatElapsed(fromIso: string, toIso: string | null, now: number): string {
    const seconds = Math.max(0, Math.round(((toIso ? Date.parse(toIso) : now) - Date.parse(fromIso)) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * 页面右下角的「后台任务」按钮：显示进行中的事务数，点击后弹框查看识别题目、生成动画讲解、
 * 重新解题、批量标注、生成试卷等耗时事务的进度与结果。
 */
export function BackgroundTasksButton() {
    const { t } = useLanguage();
    const { timeZone } = useTimeZone();
    const { status } = useSession();
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [tasks, setTasks] = useState<BackgroundTask[]>(() => backgroundTaskStore.getSnapshot());
    const [now, setNow] = useState(() => Date.now());

    const hidden = status !== "authenticated" || HIDDEN_PATHS.some((pattern) => pattern.test(pathname || ""));

    // 与 useRunningTask 等共用同一份轮询结果（backgroundTaskStore），不各自发起请求
    useEffect(() => {
        if (hidden) return;
        return backgroundTaskStore.subscribe((next) => {
            setTasks(next);
            setNow(Date.now());
        });
    }, [hidden]);

    if (hidden) return null;

    const runningCount = tasks.filter((task) => task.status === "running").length;
    const hasFinished = tasks.some((task) => task.status !== "running");
    const errorText = (code: string | null) => {
        if (!code) return null;
        const mapped = (t.backgroundTasks.errors as Record<string, string>)[code] ?? (t.errors as Record<string, unknown>)[code];
        return typeof mapped === "string" ? mapped : code;
    };

    const clearFinished = async () => {
        try {
            await apiClient.delete<{ tasks: BackgroundTask[] }>("/api/tasks");
            await backgroundTaskStore.refresh();
        } catch {
            // 忽略，下次轮询会刷新
        }
    };

    return (
        <>
            <Button
                variant="outline"
                size="icon"
                className="fixed bottom-20 right-4 z-40 h-11 w-11 rounded-full shadow-lg md:bottom-6 md:right-6 print:hidden"
                onClick={() => setOpen(true)}
                aria-label={t.backgroundTasks.title}
                title={t.backgroundTasks.title}
            >
                {runningCount > 0 ? <Loader2 className="h-5 w-5 animate-spin" /> : <ListTodo className="h-5 w-5" />}
                {runningCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs text-primary-foreground">
                        {runningCount}
                    </span>
                )}
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{t.backgroundTasks.title}</DialogTitle>
                        <DialogDescription>{t.backgroundTasks.description}</DialogDescription>
                    </DialogHeader>

                    {tasks.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">{t.backgroundTasks.empty}</p>
                    ) : (
                        <ul className="space-y-2">
                            {tasks.map((task) => (
                                <li key={task.id} className="rounded-md border p-3 text-sm">
                                    <div className="flex items-start gap-2">
                                        {task.status === "running" && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />}
                                        {task.status === "succeeded" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />}
                                        {task.status === "failed" && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <div className="font-medium">
                                                {t.backgroundTasks.kinds[task.kind]}
                                                <span className="font-normal text-muted-foreground"> · {t.backgroundTasks.status[task.status]}</span>
                                            </div>
                                            {task.subject && <div className="break-words text-muted-foreground">{task.subject}</div>}
                                            {task.progress && task.progress.total > 0 && (
                                                <div className="space-y-1">
                                                    <div className="h-1.5 overflow-hidden rounded bg-muted">
                                                        <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((task.progress.done / task.progress.total) * 100)}%` }} />
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {t.backgroundTasks.progress
                                                            .replace("{done}", String(task.progress.done))
                                                            .replace("{total}", String(task.progress.total))}
                                                        {task.progress.failed > 0 && ` · ${t.backgroundTasks.failedCount.replace("{count}", String(task.progress.failed))}`}
                                                    </div>
                                                </div>
                                            )}
                                            {task.error && <div className="text-xs text-destructive">{errorText(task.error)}</div>}
                                            <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                                                <span>{t.backgroundTasks.startedAt.replace("{time}", formatDateTime(task.startedAt, "HH:mm:ss", timeZone))}</span>
                                                <span>{t.backgroundTasks.elapsed.replace("{time}", formatElapsed(task.startedAt, task.finishedAt, now))}</span>
                                                {task.link && (
                                                    <Link href={task.link} className="text-primary hover:underline" onClick={() => setOpen(false)}>
                                                        {t.backgroundTasks.view}
                                                    </Link>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1">
                        <p className="text-xs text-muted-foreground">{t.backgroundTasks.retentionHint}</p>
                        {hasFinished && (
                            <Button variant="ghost" size="sm" onClick={clearFinished}>{t.backgroundTasks.clearFinished}</Button>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
