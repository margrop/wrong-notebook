"use client";

import { Fragment, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { useStatsData } from "@/lib/hooks/use-stats-data";
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
    const { language, t } = useLanguage();
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

    // 月份标签：每月第一周所在列显示该月简称（按界面语言）
    const monthFormatter = new Intl.DateTimeFormat(language, { month: "short" });
    // 日期是 'yyyy-MM-dd' 字符串，直接取年月，避免按 UTC 解析后在本地时区错位
    const monthKey = (date: string) => date.slice(0, 7);
    const monthLabels: (string | null)[] = weeks.map((week, idx) => {
        const monday = week[0];
        if (!monday) return null;
        const prevMonday = idx > 0 ? weeks[idx - 1][0] : null;
        if (prevMonday && monthKey(prevMonday.date) === monthKey(monday.date)) return null;
        const [year, month] = monday.date.split("-").map(Number);
        return monthFormatter.format(new Date(year, month - 1, 1));
    });

    // 星期标签：只标周一、周三、周五
    const weekdayLabels = t.activityHeatmap?.weekdays ?? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const visibleWeekdays = new Set([0, 2, 4]);

    return (
        <Card>
            <CardHeader className="pb-2">
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
            <CardContent className="pt-1">
                {/* 横向滚动容器（窄屏放不下时滚动，默认滚到最右侧看最新数据） */}
                <div ref={scrollRef} className="overflow-x-auto pb-1">
                    <div className="grid min-w-max" style={{ gridTemplateColumns: "auto repeat(26, minmax(10px, 1fr))", gap: "3px" }}>
                        {/* 月份标签行：第一列为星期标签留空 */}
                        <div />
                        {monthLabels.map((label, idx) => (
                            <div key={idx} className="text-[10px] leading-4 text-muted-foreground whitespace-nowrap">
                                {label ?? ""}
                            </div>
                        ))}

                        {/* 7 行日期方格，每行开头是星期标签 */}
                        {Array.from({ length: 7 }, (_, rowIdx) => (
                            <Fragment key={rowIdx}>
                                <div className="text-[10px] leading-4 text-muted-foreground text-right pr-1 w-7">
                                    {visibleWeekdays.has(rowIdx) ? weekdayLabels[rowIdx] : ""}
                                </div>
                                {weeks.map((week, weekIdx) => {
                                    const day = week[rowIdx];
                                    if (!day) return <div key={weekIdx} />;
                                    const level = activityLevel(day.errors + day.practices);
                                    return (
                                        <div
                                            key={day.date}
                                            className="aspect-square w-full max-w-[18px] rounded-[2px]"
                                            style={{ backgroundColor: LEVEL_COLORS[level] }}
                                            title={formatTooltip(day.date, day.errors, day.practices)}
                                            aria-label={formatTooltip(day.date, day.errors, day.practices)}
                                        />
                                    );
                                })}
                            </Fragment>
                        ))}
                    </div>
                </div>

                {/* 图例 */}
                <div className="flex items-center justify-end gap-1 mt-1 text-xs text-muted-foreground">
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
