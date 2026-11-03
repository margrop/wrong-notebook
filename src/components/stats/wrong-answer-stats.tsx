"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";

import { Loader2, CheckCircle, BookOpen, Clock, RefreshCw, Inbox, TrendingUp } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { AnalyticsData } from "@/types/api";
import { useStatsData } from "@/lib/use-stats-data";
import { StatCard } from "./stat-card";
import { SubjectPieChart } from "./subject-pie-chart";
import { StatsEmpty, StatsError } from "./stats-state";
import { MasteryProgressBar } from "./mastery-progress-bar";
import { ChartTooltip } from "./chart-tooltip";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, CHART_ADDED_COLOR, CHART_MASTERED_COLOR } from "./chart-colors";

interface WrongAnswerStatsProps {
    url: string;
}

export function WrongAnswerStats({ url }: WrongAnswerStatsProps) {
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

    const trendTitle = data.granularity === 'day'
        ? t.wrongAnswerStats.dailyTrend
        : t.wrongAnswerStats.monthlyTrend;

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
                />
                <StatCard
                    title={t.wrongAnswerStats.reviewing}
                    value={data.reviewingCount}
                    description={t.wrongAnswerStats.reviewingDesc}
                    icon={RefreshCw}
                />
                <StatCard
                    title={t.wrongAnswerStats.mastered}
                    value={data.masteredCount}
                    description={`${t.wrongAnswerStats.masteryRate}: ${data.masteryRate}%`}
                    icon={CheckCircle}
                />
            </div>

            {/* 三段式进度条：待复习 / 复习中 / 已掌握 */}
            <MasteryProgressBar
                total={data.totalErrors}
                newCount={data.newCount}
                reviewingCount={data.reviewingCount}
                masteredCount={data.masteredCount}
            />

            <div className="grid gap-4 md:grid-cols-2">
                <SubjectPieChart
                    title={t.wrongAnswerStats.SubjectDistribution}
                    data={data.subjectStats}
                />

                {/* 趋势图：新增 vs 新掌握双系列，按粒度显示每日或月度 */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4" />
                            {trendTitle}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">
                            {t.wrongAnswerStats.trendSubtitle}
                        </p>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.activityData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_COLOR} />
                                <XAxis
                                    dataKey="date"
                                    stroke={CHART_AXIS_COLOR}
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                    dy={10}
                                />
                                <YAxis
                                    stroke={CHART_AXIS_COLOR}
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                    tickFormatter={(value) => `${value}`}
                                />
                                <Tooltip
                                    content={
                                        <ChartTooltip />
                                    }
                                    cursor={{ fill: 'transparent' }}
                                />
                                <Legend
                                    iconType="circle"
                                    iconSize={8}
                                    wrapperStyle={{ paddingTop: '20px' }}
                                />
                                <Bar
                                    dataKey="added"
                                    name={t.wrongAnswerStats.added}
                                    fill={CHART_ADDED_COLOR}
                                    radius={[4, 4, 0, 0]}
                                    barSize={20}
                                />
                                <Bar
                                    dataKey="mastered"
                                    name={t.wrongAnswerStats.newlyMastered}
                                    fill={CHART_MASTERED_COLOR}
                                    radius={[4, 4, 0, 0]}
                                    barSize={20}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
