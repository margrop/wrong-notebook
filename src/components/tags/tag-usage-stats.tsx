"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import type { TagStats } from "@/types/api";

interface TagUsageStatsProps {
    stats: TagStats[];
    loading: boolean;
}

/** 知识点使用频率（Top 20），由父组件传入当前选中体系的使用次数统计 */
export function TagUsageStats({ stats, loading }: TagUsageStatsProps) {
    const { t } = useLanguage();

    if (loading) return <div className="text-center py-8">{t.tags?.stats?.loading || "Loading..."}</div>;
    if (stats.length === 0) return <div className="text-center py-8 text-muted-foreground">{t.tags?.stats?.empty || "No tag usage records yet"}</div>;
    const maxCount = stats[0]?.count || 1;
    const subjectNames = t.tags?.subjects as Record<string, string | undefined> | undefined;
    return (
        <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" />{t.tags?.stats?.frequency || "Tag Usage Frequency (Top 20)"}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
                {stats.slice(0, 20).map((stat) => (
                    <div key={stat.tagIds[0]} className="space-y-1">
                        <div className="flex justify-between items-start gap-3 text-sm">
                            <span className="min-w-0">
                                <span className="font-medium break-words">{stat.tag}</span>
                                <span className="ml-2 text-xs text-muted-foreground">
                                    {subjectNames?.[stat.subject] || stat.subject}
                                </span>
                            </span>
                            <span className="shrink-0 text-muted-foreground">{stat.count} {t.tags?.stats?.count || "times"}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary transition-all" style={{ width: `${(stat.count / maxCount) * 100}%` }} />
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
