"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import type { Notebook, PracticeQuestionListResponse, PracticeQuestionSummary } from "@/types/api";
const PAGE_SIZE = 20;
const DIFFICULTIES = ["easy", "medium", "hard", "harder"] as const;


type Status = "all" | "attempted" | "unattempted";

/** 智能练习独立入口：按错题本、知识点、难度与作答状态浏览已生成的变式题 */
export function PracticeHistory() {
    const { t } = useLanguage();
    const [notebooks, setNotebooks] = useState<Notebook[]>([]);
    const [items, setItems] = useState<PracticeQuestionSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notebookId, setNotebookId] = useState("");
    const [tag, setTag] = useState("");
    const [difficulty, setDifficulty] = useState("");
    const [status, setStatus] = useState<Status>("all");

    const fetchPage = useCallback(async (targetPage: number, append = false) => {
        if (targetPage === 1) setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
            if (notebookId) params.set("notebookId", notebookId);
            if (tag.trim()) params.set("tag", tag.trim());
            if (difficulty) params.set("difficulty", difficulty);
            if (status !== "all") params.set("status", status);
            const data = await apiClient.get<PracticeQuestionListResponse>(`/api/practice/questions?${params.toString()}`);
            setItems((current) => append ? [...current, ...data.items] : data.items);
            setTotal(data.total);
            setHasMore(data.hasMore);
            setPage(data.page);
        } catch (err) {
            frontendLogger.error('[PracticeHistory]', 'Failed to load practice questions', { error: err });
            setError(t.practice.history?.loadFailed || "Failed to load");
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [difficulty, notebookId, status, tag, t.practice.history?.loadFailed]);

    useEffect(() => {
        apiClient.get<Notebook[]>("/api/notebooks")
            .then(setNotebooks)
            .catch((err) => frontendLogger.error('[PracticeHistory]', 'Failed to load notebooks', { error: err }));
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：筛选条件变化时重新读取第一页
        void fetchPage(1);
    }, [fetchPage]);

    const resultLabel = (attempt: PracticeQuestionSummary["lastAttempt"]): string => {
        if (!attempt) return t.practice.history?.noAttempt || "Not attempted";
        if (attempt.result) return t.mastery.results[attempt.result as keyof typeof t.mastery.results] ?? attempt.result;
        return attempt.isCorrect ? t.mastery.results.correct : t.mastery.results.wrong;
    };

    return (
        <section className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
                <label className="space-y-1 text-sm">
                    <span className="font-medium">{t.practice.history?.notebook || "Notebook"}</span>
                    <Select value={notebookId || "all"} onValueChange={(value) => setNotebookId(value === "all" ? "" : value)}>
                        <SelectTrigger className="min-w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t.practice.history?.allNotebooks || "All notebooks"}</SelectItem>
                            {notebooks.map((notebook) => (
                                <SelectItem key={notebook.id} value={notebook.id}>{notebook.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </label>
                <label className="min-w-40 flex-1 space-y-1 text-sm">
                    <span className="font-medium">{t.practice.history?.tag || "Knowledge point"}</span>
                    <Input
                        value={tag}
                        onChange={(event) => setTag(event.target.value)}
                        onKeyDown={(event) => { if (event.key === "Enter") void fetchPage(1); }}
                        placeholder={t.practice.history?.tagPlaceholder || "Exact tag name"}
                    />
                </label>
                <label className="space-y-1 text-sm">
                    <span className="font-medium">{t.practice.difficulty.label}</span>
                    <Select value={difficulty || "all"} onValueChange={(value) => setDifficulty(value === "all" ? "" : value)}>
                        <SelectTrigger className="min-w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t.practice.history?.allDifficulties || "All"}</SelectItem>
                            {DIFFICULTIES.map((value) => (
                                <SelectItem key={value} value={value}>{t.practice.difficulty[value]}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </label>
                <label className="space-y-1 text-sm">
                    <span className="font-medium">{t.practice.history?.status || "Status"}</span>
                    <Select value={status} onValueChange={(value) => setStatus(value as Status)}>
                        <SelectTrigger className="min-w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t.practice.history?.statusAll || "All"}</SelectItem>
                            <SelectItem value="attempted">{t.practice.history?.statusAttempted || "Attempted"}</SelectItem>
                            <SelectItem value="unattempted">{t.practice.history?.statusUnattempted || "Not attempted"}</SelectItem>
                        </SelectContent>
                    </Select>
                </label>
                <Button type="button" variant="outline" onClick={() => { void fetchPage(1); }} disabled={loading}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t.practice.history?.refresh || "Refresh"}
                </Button>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {loading ? (
                <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : items.length === 0 ? (
                <EmptyState icon={Sparkles} title={t.practice.history?.empty || "No generated practice questions yet"} />
            ) : (
                <div className="grid gap-3 md:grid-cols-2">
                    {items.map((item) => (
                        <Link key={item.id} href={`/practice?questionId=${item.id}`}>
                            <Card className="h-full rounded-2xl transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                                <CardContent className="space-y-2 pt-4">
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="line-clamp-2 font-medium">{item.questionText}</span>
                                        <span className="shrink-0 text-xs text-muted-foreground">
                                            {item.errorItem?.seqNo ? `#${item.errorItem.seqNo}` : item.errorItem?.shortId ?? ""}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                        {item.errorItem?.subject?.name && <span>{item.errorItem.subject.name}</span>}
                                        <span>{item.difficulty ? t.practice.difficulty[item.difficulty as keyof typeof t.practice.difficulty] ?? item.difficulty : t.practice.difficulty.Unknown}</span>
                                        <span>{(t.practice.history?.attempts || "Attempts: {count}").replace("{count}", String(item.attemptCount))}</span>
                                        <span>{resultLabel(item.lastAttempt)}</span>
                                    </div>
                                    {!item.errorItem && (
                                        <p className="text-xs text-muted-foreground">{t.practice.history?.originalDeleted || "The original question was deleted"}</p>
                                    )}
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            )}

            {hasMore && (
                <Button type="button" variant="outline" onClick={() => { void fetchPage(page + 1, true); }} disabled={loadingMore}>
                    {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {t.practice.history?.loadMore || "Load more"}
                </Button>
            )}
            {!loading && items.length > 0 && (
                <p className="text-xs text-muted-foreground">{(t.practice.history?.total || "Total: {count}").replace("{count}", String(total))}</p>
            )}
        </section>
    );
}
