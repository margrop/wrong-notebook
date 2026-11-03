"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

import { Loader2, TrendingUp, CheckCircle, BookOpen, Inbox } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { AnalyticsData } from "@/types/api";
import { useStatsData } from "@/lib/use-stats-data";
import { StatCard } from "./stat-card";
import { SubjectPieChart } from "./subject-pie-chart";
import { StatsEmpty, StatsError } from "./stats-state";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, CHART_BAR_GRADIENT_START } from "./chart-colors";

export function WrongAnswerStats() {
    const { t } = useLanguage();
    const { data, loading, error, reload } = useStatsData<AnalyticsData>("/api/analytics");

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

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <h2 className="text-2xl font-bold tracking-tight">
                {t.wrongAnswerStats.title}
            </h2>

            <div className="grid gap-4 md:grid-cols-3">
                <StatCard
                    title={t.wrongAnswerStats.totalErrors}
                    value={data.totalErrors}
                    description={t.wrongAnswerStats.totalErrorsDesc}
                    icon={BookOpen}
                />
                <StatCard
                    title={t.wrongAnswerStats.mastered}
                    value={data.masteredCount}
                    description={t.wrongAnswerStats.masteredDesc}
                    icon={CheckCircle}
                />
                <StatCard
                    title={t.wrongAnswerStats.masteryRate}
                    value={`${data.masteryRate}%`}
                    description={t.wrongAnswerStats.masteryRateDesc}
                    icon={TrendingUp}
                />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <SubjectPieChart
                    title={t.wrongAnswerStats.SubjectDistribution}
                    data={data.subjectStats}
                />

                {/* Monthly Trend */}
                <Card>
                    <CardHeader>
                        <CardTitle>{t.wrongAnswerStats.MonthlyTrend}</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.activityData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={CHART_BAR_GRADIENT_START} stopOpacity={0.8} />
                                        <stop offset="95%" stopColor={CHART_BAR_GRADIENT_START} stopOpacity={0.1} />
                                    </linearGradient>
                                </defs>
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
                                        <MonthlyTooltip activityLabel={t.wrongAnswerStats.activity} />
                                    }
                                    cursor={{ fill: 'transparent' }}
                                />
                                <Bar
                                    dataKey="count"
                                    fill="url(#colorCount)"
                                    radius={[4, 4, 0, 0]}
                                    barSize={40}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

interface MonthlyTooltipProps {
    active?: boolean;
    payload?: Array<{ name?: string | number; value?: string | number; color?: string }>;
    label?: string | number;
    activityLabel: string;
}

function MonthlyTooltip({ active, payload, label, activityLabel }: MonthlyTooltipProps) {
    if (active && payload && payload.length) {
        return (
            <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
                <p className="font-medium mb-1">{label}</p>
                <div className="flex items-center gap-2">
                    <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: CHART_BAR_GRADIENT_START }}
                    />
                    <span className="text-muted-foreground">{activityLabel}:</span>
                    <span className="font-bold">{payload[0].value}</span>
                </div>
            </div>
        );
    }
    return null;
}
