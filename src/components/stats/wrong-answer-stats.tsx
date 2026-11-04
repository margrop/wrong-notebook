"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, BookOpen, Clock, RefreshCw, Inbox } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { AnalyticsData } from "@/types/api";
import { useStatsData } from "@/lib/hooks/use-stats-data";
import { StatCard } from "./stat-card";
import { StatsEmpty, StatsError } from "./stats-state";
import { WeakTagsCard } from "./weak-tags-card";
import { MasteryProgressBar } from "./mastery-progress-bar";
import { WrongAnswerCharts } from "./wrong-answer-charts";

interface WrongAnswerStatsProps {
    url: string;
    /** 薄弱知识点排行接口地址 */
    weakTagsUrl: string;
    /** 当前选中的错题本 id；选中时待复习 / 复习中 / 已掌握卡片链接到对应筛选的错题列表 */
    subjectId?: string;
}

export function WrongAnswerStats({ url, weakTagsUrl, subjectId }: WrongAnswerStatsProps) {
    const { t } = useLanguage();
    const { data, loading, error, reload } = useStatsData<AnalyticsData>(url);

    if (loading) {
        return (
            <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (error) {
        return <StatsError onRetry={reload} />;
    }

    if (!data || data.totalErrors === 0) {
        return (
            <StatsEmpty
                icon={Inbox}
                title={t.statsState?.wrongEmptyTitle || "No wrong answers yet"}
                description={t.statsState?.wrongEmptyDesc || "Wrong answers you record will appear here."}
                action={
                    <Button asChild variant="outline" size="sm">
                        <Link href="/">{t.statsState?.goToHome || "Go to Home"}</Link>
                    </Button>
                }
            />
        );
    }

    const masteryHref = (status: 'new' | 'reviewing' | 'mastered') =>
        subjectId ? `/notebooks/${subjectId}?mastery=${status}` : undefined;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <h2 className="text-2xl font-bold tracking-tight">
                {t.wrongAnswerStats.title}
            </h2>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard
                    title={t.wrongAnswerStats.totalErrors}
                    value={data.totalErrors}
                    description={t.wrongAnswerStats.totalErrorsDesc}
                    icon={BookOpen}
                />
                <StatCard
                    title={t.wrongAnswerStats.new}
                    value={data.newCount}
                    description={t.wrongAnswerStats.newDesc}
                    icon={Clock}
                    href={masteryHref('new')}
                    aria-label={t.wrongAnswerStats.viewNew}
                />
                <StatCard
                    title={t.wrongAnswerStats.reviewing}
                    value={data.reviewingCount}
                    description={t.wrongAnswerStats.reviewingDesc}
                    icon={RefreshCw}
                    href={masteryHref('reviewing')}
                    aria-label={t.wrongAnswerStats.viewReviewing}
                />
                <StatCard
                    title={t.wrongAnswerStats.mastered}
                    value={data.masteredCount}
                    description={`${t.wrongAnswerStats.masteryRate}: ${data.masteryRate}%`}
                    icon={CheckCircle}
                    href={masteryHref('mastered')}
                    aria-label={t.wrongAnswerStats.viewMastered}
                />
            </div>

            {/* 三段式进度条：待复习 / 复习中 / 已掌握 */}
            <MasteryProgressBar
                total={data.totalErrors}
                newCount={data.newCount}
                reviewingCount={data.reviewingCount}
                masteredCount={data.masteredCount}
            />

            {/* 薄弱知识点排行：概览与进度条下方、图表上方 */}
            <WeakTagsCard url={weakTagsUrl} />

            {/* 图表区：科目分布 / 趋势 / 错因分布 */}
            <WrongAnswerCharts data={data} />
        </div>
    );
}
