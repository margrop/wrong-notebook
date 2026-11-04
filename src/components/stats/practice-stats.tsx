"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Loader2, TrendingUp, BookOpen, Target, ClipboardList } from "lucide-react";
import { PracticeStatsData } from "@/types/api";
import { useStatsData } from "@/lib/hooks/use-stats-data";
import { StatCard } from "./stat-card";
import { ChartTooltip } from "./chart-tooltip";
import { SubjectPieChart } from "./subject-pie-chart";
import { StatsEmpty, StatsError } from "./stats-state";
import { COLORS, DIFFICULTY_COLORS, CHART_GRID_COLOR, CHART_AXIS_COLOR } from "./chart-colors";

interface PracticeStatsProps {
    url: string;
}

export function PracticeStats({ url }: PracticeStatsProps) {
    const { t } = useLanguage();
    const { data: stats, loading, error, reload } = useStatsData<PracticeStatsData>(url);

    if (loading) {
        return (
            <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (error) {
        return <StatsError onRetry={reload} />;
    }

    if (!stats || stats.overallStats.total === 0) {
        return (
            <StatsEmpty
                icon={ClipboardList}
                title={t.statsState?.practiceEmptyTitle || "No practice records yet"}
                description={t.statsState?.practiceEmptyDesc || "Practice questions will appear here after you complete practice sessions."}
                action={
                    <Button asChild variant="outline" size="sm">
                        <Link href="/review">{t.statsState?.goToReview || "Go to Review"}</Link>
                    </Button>
                }
            />
        );
    }

    // Helper to translate difficulty
    const getDifficultyLabel = (key: string) => {
        const labels: Record<string, string | undefined> = t.practice?.difficulty ?? {};
        return labels[key] || key;
    };

    // Get unique difficulties for the bar chart
    const difficulties = stats.difficultyStats.map(d => d.name);

    const trendTitle = stats.granularity === 'day'
        ? (t.stats?.dailyTrend || "Daily Trend")
        : (t.stats?.monthlyTrend || "Monthly Trend");

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold tracking-tight">{t.stats?.title || "Practice Statistics"}</h2>

            {/* Overview Cards */}
            <div className="grid gap-4 md:grid-cols-3">
                <StatCard
                    title={t.stats?.totalPractices || "Total Practiced"}
                    value={stats.overallStats.total}
                    icon={BookOpen}
                />
                <StatCard
                    title={t.stats?.correctRate || "Correct Rate"}
                    value={`${stats.overallStats.rate}%`}
                    description={`${stats.overallStats.correct} / ${stats.overallStats.attempted} ${t.stats?.attempted || "Attempted"}`}
                    icon={Target}
                />
                <StatCard
                    title={t.stats?.activeDays || "Active Days"}
                    value={stats.activeDays}
                    icon={TrendingUp}
                />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <SubjectPieChart
                    title={t.stats?.subjectDistribution || "Subject Distribution"}
                    data={stats.subjectStats}
                />

                {/* 趋势图：按粒度显示每日或月度 */}
                <Card>
                    <CardHeader>
                        <CardTitle>{trendTitle}</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.activityStats} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_COLOR} />
                                <XAxis
                                    dataKey="date"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: CHART_AXIS_COLOR, fontSize: 12 }}
                                    dy={10}
                                />
                                <YAxis
                                    allowDecimals={false}
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: CHART_AXIS_COLOR, fontSize: 12 }}
                                />
                                <Tooltip
                                    content={
                                        <ChartTooltip totalLabel={t.stats?.total || "Total"} />
                                    }
                                    cursor={{ fill: 'transparent' }}
                                />
                                <Legend
                                    iconType="circle"
                                    iconSize={8}
                                    wrapperStyle={{ paddingTop: '20px' }}
                                />
                                {difficulties.map((diff, index) => (
                                    <Bar
                                        key={diff}
                                        dataKey={diff}
                                        name={getDifficultyLabel(diff)}
                                        stackId="a"
                                        fill={DIFFICULTY_COLORS[diff] || COLORS[index % COLORS.length]}
                                        radius={index === difficulties.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                                        barSize={32}
                                    />
                                ))}
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
