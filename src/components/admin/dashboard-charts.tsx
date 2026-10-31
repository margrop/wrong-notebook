"use client";

import { Users, BookOpen, PenTool, Layers, TrendingUp, CheckCircle, Clock, AlertCircle, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Translations } from "@/lib/translations";
import type { AdminDashboardData } from "@/types/api";

/** 管理员仪表盘的概览卡片与统计图表 */
export function OverviewCards({ data, t }: { data: AdminDashboardData; t: Translations }) {
    const cards = [
        {
            title: t.admin?.dashboard?.totalUsers || "Total Users",
            value: data.overview.totalUsers,
            icon: Users,
            color: "text-blue-500",
            bgColor: "bg-blue-50 dark:bg-blue-950/30",
        },
        {
            title: t.admin?.dashboard?.totalErrors || "Total Errors",
            value: data.overview.totalErrorItems,
            icon: BookOpen,
            color: "text-red-500",
            bgColor: "bg-red-50 dark:bg-red-950/30",
        },
        {
            title: t.admin?.dashboard?.totalPractice || "Total Practice",
            value: data.overview.totalPracticeRecords,
            icon: PenTool,
            color: "text-green-500",
            bgColor: "bg-green-50 dark:bg-green-950/30",
        },
        {
            title: t.admin?.dashboard?.totalNotebooks || "Total Notebooks",
            value: data.overview.totalSubjects,
            icon: Layers,
            color: "text-purple-500",
            bgColor: "bg-purple-50 dark:bg-purple-950/30",
        },
    ]

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map((card) => (
                <Card key={card.title} className="border-0 shadow-sm">
                    <CardContent className="p-4 flex items-center gap-4">
                        <div className={`p-3 rounded-xl ${card.bgColor}`}>
                            <card.icon className={`h-6 w-6 ${card.color}`} />
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">{card.title}</p>
                            <p className="text-2xl font-bold">{card.value}</p>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}

export function DailyTrendChart({ data, t }: { data: AdminDashboardData; t: Translations }) {
    const maxCount = Math.max(...data.dailyTrend.map(d => d.count), 1)

    return (
        <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-orange-500" />
                    {t.admin?.dashboard?.recentTrend || "Recent 7-Day Trend"}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-end gap-2 h-40">
                    {data.dailyTrend.map((d) => {
                        const height = maxCount > 0 ? (d.count / maxCount) * 100 : 0
                        const label = d.date.slice(5).replace('-', '/')
                        return (
                            <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                                <span className="text-xs font-medium">{d.count > 0 ? d.count : ""}</span>
                                <div className="w-full relative" style={{ height: "100px" }}>
                                    <div
                                        className="absolute bottom-0 w-full bg-gradient-to-t from-orange-500 to-orange-400 rounded-t-md transition-all duration-500 min-h-[4px]"
                                        style={{ height: `${Math.max(height, 4)}%` }}
                                    />
                                </div>
                                <span className="text-xs text-muted-foreground">{label}</span>
                            </div>
                        )
                    })}
                </div>
            </CardContent>
        </Card>
    )
}

export function SubjectDistributionChart({ data, t }: { data: AdminDashboardData; t: Translations }) {
    const total = data.subjectDistribution.reduce((sum, s) => sum + s.count, 0)
    const colors = [
        "bg-blue-500", "bg-green-500", "bg-orange-500", "bg-purple-500",
        "bg-red-500", "bg-cyan-500", "bg-yellow-500", "bg-pink-500", "bg-indigo-500",
    ]

    return (
        <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-blue-500" />
                    {t.admin?.dashboard?.subjectDistribution || "Subject Distribution"}
                </CardTitle>
            </CardHeader>
            <CardContent>
                {total === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                        {t.admin?.dashboard?.noData || "No Data"}
                    </p>
                ) : (
                    <div className="space-y-3">
                        {data.subjectDistribution.map((s, i) => {
                            const pct = total > 0 ? Math.round((s.count / total) * 100) : 0
                            return (
                                <div key={s.name} className="space-y-1">
                                    <div className="flex justify-between text-sm">
                                        <span className="font-medium">{s.name}</span>
                                        <span className="text-muted-foreground">{s.count} ({pct}%)</span>
                                    </div>
                                    <div className="w-full bg-muted rounded-full h-2.5">
                                        <div
                                            className={`h-2.5 rounded-full ${colors[i % colors.length]} transition-all duration-500`}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

export function MasteryDistributionCard({ data, t }: { data: AdminDashboardData; t: Translations }) {
    const total = data.masteryDistribution.new + data.masteryDistribution.reviewing + data.masteryDistribution.mastered
    const items = [
        { key: "new", label: t.admin?.dashboard?.masteryNew || "To Review", count: data.masteryDistribution.new, icon: AlertCircle, color: "text-red-500", bg: "bg-red-500" },
        { key: "reviewing", label: t.admin?.dashboard?.masteryReviewing || "Reviewing", count: data.masteryDistribution.reviewing, icon: Clock, color: "text-yellow-500", bg: "bg-yellow-500" },
        { key: "mastered", label: t.admin?.dashboard?.masteryMastered || "Mastered", count: data.masteryDistribution.mastered, icon: CheckCircle, color: "text-green-500", bg: "bg-green-500" },
    ]

    return (
        <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    {t.admin?.dashboard?.masteryDistribution || "Mastery Distribution"}
                </CardTitle>
            </CardHeader>
            <CardContent>
                {total === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                        {t.admin?.dashboard?.noData || "No Data"}
                    </p>
                ) : (
                    <div className="space-y-3">
                        {items.map((item) => {
                            const pct = total > 0 ? Math.round((item.count / total) * 100) : 0
                            return (
                                <div key={item.key} className="space-y-1">
                                    <div className="flex justify-between text-sm items-center">
                                        <span className="flex items-center gap-1.5 font-medium">
                                            <item.icon className={`h-4 w-4 ${item.color}`} />
                                            {item.label}
                                        </span>
                                        <span className="text-muted-foreground">{item.count} ({pct}%)</span>
                                    </div>
                                    <div className="w-full bg-muted rounded-full h-2.5">
                                        <div
                                            className={`h-2.5 rounded-full ${item.bg} transition-all duration-500`}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
