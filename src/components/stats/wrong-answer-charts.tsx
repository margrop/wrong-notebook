"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { TrendingUp } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { AnalyticsData } from "@/types/api";
import { SubjectPieChart } from "./subject-pie-chart";
import { MistakeCauseCard } from "./mistake-cause-card";
import { DifficultyStarsCard } from "./difficulty-stars-card";
import { ChartTooltip } from "./chart-tooltip";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, CHART_ADDED_COLOR, CHART_MASTERED_COLOR } from "./chart-colors";

interface WrongAnswerChartsProps {
    data: AnalyticsData;
}

/** 错题统计图表区：科目分布、趋势与错因分布 */
export function WrongAnswerCharts({ data }: WrongAnswerChartsProps) {
    const { t } = useLanguage();
    const trendTitle = data.granularity === 'day'
        ? t.wrongAnswerStats.dailyTrend
        : t.wrongAnswerStats.monthlyTrend;

    return (
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

            {/* 错因分布：作答状态环形图 + 错误类型条形列表 */}
            <MistakeCauseCard
                title={t.wrongAnswerStats.mistakeCause}
                subtitle={t.wrongAnswerStats.mistakeCauseSubtitle}
                mistakeStatusStats={data.mistakeStatusStats}
                errorTypeStats={data.errorTypeStats}
                errorTypeOtherLabel={t.wrongAnswerStats.errorTypeOther}
                errorTypeEmptyText={t.wrongAnswerStats.errorTypeEmpty}
            />

            {/* 难度分布：仅在有已评星错题或未评定错题时显示 */}
            {data.difficultyStarsStats.some(s => s.total > 0) && (
                <DifficultyStarsCard
                    title={t.wrongAnswerStats.difficultyDistribution}
                    subtitle={t.wrongAnswerStats.difficultyDistributionSubtitle}
                    stats={data.difficultyStarsStats}
                    unratedLabel={t.difficulty.unrated}
                />
            )}
        </div>
    );
}
