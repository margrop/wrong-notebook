"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { CHART_MASTERED_COLOR } from "./chart-colors";

export interface DifficultyStarsCardProps {
    title: string;
    subtitle: string;
    /** 难度分布数据，始终包含 1~5 星；未评定为 stars: null */
    stats: { stars: number | null; total: number; mastered: number }[];
    unratedLabel: string;
}

/** 难度分布卡片：每个难度一行横向叠加条形图（已掌握 + 未掌握） */
export function DifficultyStarsCard({ title, subtitle, stats, unratedLabel }: DifficultyStarsCardProps) {
    const { t } = useLanguage();
    const maxTotal = stats.reduce((max, s) => Math.max(max, s.total), 0);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Star className="h-4 w-4" />
                    {title}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{subtitle}</p>
            </CardHeader>
            <CardContent>
                <ul className="space-y-3">
                    {stats.map((item) => {
                        const masteredWidth = maxTotal > 0
                            ? ((item.mastered / maxTotal) * 100).toFixed(1)
                            : "0";
                        const totalWidth = maxTotal > 0
                            ? (item.total / maxTotal) * 100
                            : 0;
                        const unmasteredWidth = (totalWidth - (maxTotal > 0 ? (item.mastered / maxTotal) * 100 : 0)).toFixed(1);
                        const label = item.stars !== null
                            ? t.difficulty.starsLabel.replace("{n}", String(item.stars))
                            : unratedLabel;
                        return (
                            <li key={item.stars ?? 'unrated'} className="space-y-1">
                                <div className="flex items-center justify-between text-sm">
                                    <span>{label}</span>
                                    <span className="text-muted-foreground">
                                        {item.mastered} / {item.total}
                                    </span>
                                </div>
                                <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                                    {/* 已掌握部分 */}
                                    <div
                                        className="h-full"
                                        style={{
                                            width: `${masteredWidth}%`,
                                            backgroundColor: CHART_MASTERED_COLOR,
                                        }}
                                    />
                                    {/* 未掌握部分 */}
                                    <div
                                        className="h-full bg-muted-foreground/20"
                                        style={{
                                            width: `${unmasteredWidth}%`,
                                        }}
                                    />
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </CardContent>
        </Card>
    );
}
