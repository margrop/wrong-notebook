"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarCheck, ListOrdered, Loader2, RefreshCw } from "lucide-react";
import { ErrorItemCard } from "@/components/error-list/error-item-card";
import { ReviewSession } from "@/components/review/review-session";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { apiClient } from "@/lib/api-client";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { formatDateTime, getDayRange } from "@/lib/date-time";
import { frontendLogger } from "@/lib/frontend-logger";
import { usePageTitle } from "@/lib/page-title";
import { REVIEW_INTERVALS } from "@/lib/review-schedule";
import type { DueReviewItem, PaginatedResponse } from "@/types/api";

/** 页码保存在 ?page= 中，翻页后返回或刷新仍停留在当前页 */
function parsePage(value: string | null): number {
    const page = Number(value);
    return Number.isInteger(page) && page > 0 ? page : 1;
}

function ReviewContent() {
    const { t } = useLanguage();
    const { timeZone } = useTimeZone();
    usePageTitle(t.review.title);
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const page = parsePage(searchParams.get("page"));
    const [data, setData] = useState<PaginatedResponse<DueReviewItem> | null>(null);
    const [sessionActive, setSessionActive] = useState(false);

    const fetchDue = useCallback(async (targetPage: number) => {
        try {
            setData(await apiClient.get<PaginatedResponse<DueReviewItem>>(`/api/review/due?page=${targetPage}&pageSize=${DEFAULT_PAGE_SIZE}`));
        } catch (error) {
            frontendLogger.error('[Review]', 'Failed to fetch due reviews', { error });
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面或翻页时加载，请求完成后更新结果
        fetchDue(page);
    }, [page, fetchDue]);

    const changePage = (targetPage: number) => {
        const params = new URLSearchParams(searchParams.toString());
        if (targetPage === 1) params.delete("page");
        else params.set("page", String(targetPage));
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };

    // 结束顺序复习后刷新当前页，掌握状态与到期时间已由服务端更新
    const closeSession = () => {
        setSessionActive(false);
        void fetchDue(page);
    };

    const todayStart = getDayRange(new Date(), timeZone).start;
    const dueLabel = (item: DueReviewItem) => {
        const date = formatDateTime(item.nextReviewAt, "MM/dd", timeZone);
        return new Date(item.nextReviewAt) < todayStart
            ? t.review.overdue.replace("{date}", date)
            : t.review.dueOn.replace("{date}", date);
    };

    const hasDue = !!data && data.total > 0;

    return (
        <>
            <PageHeader
                title={t.review.title}
                description={t.review.desc}
                actions={hasDue && (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
                            {t.review.dueCount.replace("{count}", String(data.total))}
                        </span>
                        {sessionActive ? (
                            <Button variant="outline" size="sm" onClick={closeSession}>
                                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                                {t.review.sessionBack}
                            </Button>
                        ) : (
                            <Button size="sm" onClick={() => setSessionActive(true)}>
                                <ListOrdered className="mr-1.5 h-3.5 w-3.5" />
                                {t.review.sessionStart}
                            </Button>
                        )}
                    </div>
                )}
            />

            {/* 顶部页码：方便从当前页直接跳到其他页 */}
            {!sessionActive && data && data.total > 0 && (
                <Pagination
                    page={page}
                    totalPages={data.totalPages}
                    total={data.total}
                    pageSize={data.pageSize}
                    onPageChange={changePage}
                    showSummary={false}
                />
            )}

            {sessionActive && hasDue ? (
                <ReviewSession onClose={closeSession} />
            ) : (
                <>
                    {!data && (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {Array.from({ length: 6 }, (_, i) => (
                                <div key={i} className="h-52 animate-pulse rounded-2xl bg-muted" />
                            ))}
                        </div>
                    )}

                    {data && data.total === 0 && (
                        <EmptyState icon={CalendarCheck} title={t.review.empty} description={t.review.emptyHint} />
                    )}

                    {data && data.items.length > 0 && (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {data.items.map((item) => (
                                <div key={item.id} className="flex flex-col gap-2">
                                    <div className="flex-1">
                                        <ErrorItemCard item={item} selectMode={false} selected={false} onToggleSelect={() => {}} selectedTag={null} onTagClick={() => {}} />
                                    </div>
                                    <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
                                        <span>
                                            {dueLabel(item)} · {t.review.round.replace("{round}", String(item.reviewStage + 1)).replace("{total}", String(REVIEW_INTERVALS.length))}
                                        </span>
                                        <Link href={`/practice?id=${item.id}`}>
                                            <Button variant="outline" size="sm" className="h-8">
                                                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                                {t.review.practice}
                                            </Button>
                                        </Link>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {data && (
                        <Pagination
                            page={page}
                            totalPages={data.totalPages}
                            total={data.total}
                            pageSize={data.pageSize}
                            onPageChange={changePage}
                        />
                    )}
                </>
            )}
        </>
    );
}

export default function ReviewPage() {
    return (
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8 md:py-8">
            <Suspense fallback={
                <div className="flex justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            }>
                <ReviewContent />
            </Suspense>
        </main>
    );
}
