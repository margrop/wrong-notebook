"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Loader2, TrendingUp, BookOpen, Target } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { PracticeStatsData } from "@/types/api";
import { StatCard } from "./stat-card";
import { ChartTooltip } from "./chart-tooltip";
import { SubjectPieChart } from "./subject-pie-chart";
import { COLORS, DIFFICULTY_COLORS } from "./chart-colors";

export function PracticeStats() {
    const { t } = useLanguage();
    const [stats, setStats] = useState<PracticeStatsData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiClient.get<PracticeStatsData>("/api/stats/practice")
            .then(data => {
                setStats(data);
                setLoading(false);
            })
            .catch(err => {
                frontendLogger.error('[PracticeStats]', 'Failed to fetch stats', { error: err });
                setLoading(false);
            });
    }, []);

    if (loading) {
        return (
            <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!stats || stats.overallStats.total === 0) {
        return null; // Don't show if no data
    }

    // Helper to translate difficulty
    const getDifficultyLabel = (key: string) => {
        const labels: Record<string, string | undefined> = t.practice?.difficulty ?? {};
        return labels[key] || key;
    };

    // Get unique difficulties for the bar chart
    const difficulties = stats.difficultyStats.map(d => d.name);

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
                    title={t.stats?.activeDays || "Active Days (6m)"}
                    value={stats.activityStats.filter(d => d.total > 0).length}
                    icon={TrendingUp}
                />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <SubjectPieChart
                    title={t.stats?.subjectDistribution || "Subject Distribution"}
                    data={stats.subjectStats}
                />

                {/* Monthly Activity with Difficulty Stack */}
                <Card className="col-span-2 md:col-span-1">
                    <CardHeader>
                        <CardTitle>{t.stats?.weeklyTrend || "Monthly Trend"}</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stats.activityStats} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                <XAxis
                                    dataKey="date"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#6b7280', fontSize: 12 }}
                                    dy={10}
                                />
                                <YAxis
                                    allowDecimals={false}
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#6b7280', fontSize: 12 }}
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
