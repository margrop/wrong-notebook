"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { useStatsData } from "@/lib/use-stats-data";
import { ActivityStatsData } from "@/types/api";
import { Loader2 } from "lucide-react";

interface ActivityHeatmapProps {
    url: string;
}

/** 根据活动总数返回颜色档位（0~4） */
function activityLevel(total: number): number {
    if (total <= 0) return 0;
    if (total <= 2) return 1;
    if (total <= 4) return 2;
    if (total <= 6) return 3;
    return 4;
}

/** 各档位颜色：0 用 muted，1~4 用 chart-2 透明度递增 */
const LEVEL_COLORS = [
    "var(--muted)",
    "color-mix(in oklch, var(--chart-2) 25%, transparent)",
    "color-mix(in oklch, var(--chart-2) 50%, transparent)",
    "color-mix(in oklch, var(--chart-2) 75%, transparent)",
    "var(--chart-2)",
];

export function ActivityHeatmap({ url }: ActivityHeatmapProps) {
    const { t } = useLanguage();
    const { data: stats, loading, error } = useStatsData<ActivityStatsData>(url);
    const scrollRef = useRef<HTMLDivElement>(null);

    // 默认滚动到最右侧（最新数据）
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
    }, [stats]);

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>{t.activityHeatmap?.title || "Learning Calendar"}</CardTitle>
                </CardHeader>
                <CardContent className="flex justify-center p-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>{t.activityHeatmap?.title || "Learning Calendar"}</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                        {t.statsState?.errorDesc || "Failed to load data"}
                    </p>
                </CardContent>
            </Card>
        );
    }

    if (!stats) return null;

    // 按列（周）分组：每列 7 天，从周一开始
    const weeks: { date: string; errors: number; practices: number }[][] = [];
    for (let i = 0; i < stats.days.length; i += 7) {
        weeks.push(stats.days.slice(i, i + 7));
    }

    const levelLabel = (level: number) => {
        const labels = t.activityHeatmap?.levels ?? ["None", "Low", "Medium", "High", "Very High"];
        return labels[level] ?? String(level);
    };

    const formatTooltip = (date: string, errors: number, practices: number) => {
        const template = t.activityHeatmap?.dayTooltip || "{date}: {errors} questions, {practices} practices";
        return template
            .replace("{date}", date)
            .replace("{errors}", String(errors))
            .replace("{practices}", String(practices));
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base font-semibold">
                        {t.activityHeatmap?.title || "Learning Calendar"}
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span>
                            {t.activityHeatmap?.currentStreak || "Current Streak"}:{" "}
                            <span className="font-semibold text-foreground">{stats.currentStreak}</span>
                        </span>
                        <span>
                            {t.activityHeatmap?.longestStreak || "Longest Streak"}:{" "}
                            <span className="font-semibold text-foreground">{stats.longestStreak}</span>
                        </span>
                        <span>
                            {t.activityHeatmap?.totalActiveDays || "Total Active Days"}:{" "}
                            <span className="font-semibold text-foreground">{stats.totalActiveDays}</span>
                        </span>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {/* 横向滚动容器 */}
                <div ref={scrollRef} className="overflow-x-auto pb-2">
                    <div className="inline-flex gap-1 min-w-max">
                        {weeks.map((week, weekIdx) => (
                            <div key={weekIdx} className="flex flex-col gap-1">
                                {week.map((day) => {
                                    const level = activityLevel(day.errors + day.practices);
                                    return (
                                        <div
                                            key={day.date}
                                            className="h-3 w-3 rounded-sm"
                                            style={{ backgroundColor: LEVEL_COLORS[level] }}
                                            title={formatTooltip(day.date, day.errors, day.practices)}
                                            aria-label={formatTooltip(day.date, day.errors, day.practices)}
                                        />
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>

                {/* 图例 */}
                <div className="flex items-center justify-end gap-1 mt-2 text-xs text-muted-foreground">
                    <span>{t.activityHeatmap?.less || "Less"}</span>
                    {LEVEL_COLORS.map((color, idx) => (
                        <div
                            key={idx}
                            className="h-3 w-3 rounded-sm"
                            style={{ backgroundColor: color }}
                            title={levelLabel(idx)}
                        />
                    ))}
                    <span>{t.activityHeatmap?.more || "More"}</span>
                </div>
            </CardContent>
        </Card>
    );
}
