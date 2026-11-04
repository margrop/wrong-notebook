"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { PieChart as PieChartIcon } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { getMistakeStatusLabel } from "@/lib/question/mistake-status";
import { COLORS } from "./chart-colors";

export interface MistakeCauseCardProps {
    title: string;
    subtitle: string;
    mistakeStatusStats: { name: string; value: number }[];
    errorTypeStats: { name: string; value: number }[];
    errorTypeOtherLabel: string;
    errorTypeEmptyText: string;
}

/** 错因分布卡片：上半部分为作答状态环形图，下半部分为错误类型横向条形列表 */
export function MistakeCauseCard({
    title,
    subtitle,
    mistakeStatusStats,
    errorTypeStats,
    errorTypeOtherLabel,
    errorTypeEmptyText,
}: MistakeCauseCardProps) {
    const { language } = useLanguage();
    const statusTotal = mistakeStatusStats.reduce((sum, item) => sum + item.value, 0);
    const maxErrorTypeValue = errorTypeStats.reduce((max, item) => Math.max(max, item.value), 0);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <PieChartIcon className="h-4 w-4" />
                    {title}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{subtitle}</p>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* 作答状态环形图 + 图例 */}
                {mistakeStatusStats.length > 0 ? (
                    <div>
                        <div className="h-[180px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={mistakeStatusStats}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={45}
                                        outerRadius={65}
                                        fill={COLORS[0]}
                                        paddingAngle={4}
                                        dataKey="value"
                                    >
                                        {mistakeStatusStats.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                            {mistakeStatusStats.map((item, index) => {
                                const percent = statusTotal > 0 ? ((item.value / statusTotal) * 100).toFixed(0) : "0";
                                return (
                                    <li key={item.name} className="flex items-center gap-1.5">
                                        <span
                                            className="inline-block h-3 w-3 shrink-0 rounded-sm"
                                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                        />
                                        <span className="text-muted-foreground">
                                            {getMistakeStatusLabel(item.name, language)} {item.value} ({percent}%)
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ) : null}

                {/* 错误类型横向条形列表 */}
                <div>
                    {errorTypeStats.length > 0 ? (
                        <ul className="space-y-3">
                            {errorTypeStats.map((item, index) => {
                                const displayName = item.name === '__other__' ? errorTypeOtherLabel : item.name;
                                const widthPercent = maxErrorTypeValue > 0
                                    ? ((item.value / maxErrorTypeValue) * 100).toFixed(1)
                                    : "0";
                                return (
                                    <li key={item.name} className="space-y-1">
                                        <div className="flex items-center justify-between text-sm">
                                            <span>{displayName}</span>
                                            <span className="text-muted-foreground">{item.value}</span>
                                        </div>
                                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                            <div
                                                className="h-full rounded-full"
                                                style={{
                                                    width: `${widthPercent}%`,
                                                    backgroundColor: COLORS[index % COLORS.length],
                                                }}
                                            />
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted-foreground italic">{errorTypeEmptyText}</p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
