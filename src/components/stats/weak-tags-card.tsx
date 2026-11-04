"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, RotateCcw, Award } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { WeakTagsData } from "@/types/api";
import { useStatsData } from "@/lib/hooks/use-stats-data";

interface WeakTagsCardProps {
    url: string;
}

/** 错题统计「薄弱知识点」排行卡片 */
export function WeakTagsCard({ url }: WeakTagsCardProps) {
    const { t } = useLanguage();
    const { data, loading, error, reload } = useStatsData<WeakTagsData>(url);

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Award className="h-4 w-4" />
                        {t.weakTags.title}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">{t.weakTags.subtitle}</p>
                </CardHeader>
                <CardContent className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Award className="h-4 w-4" />
                        {t.weakTags.title}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>{t.weakTags.loadError}</span>
                        <Button variant="ghost" size="sm" onClick={reload}>
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                            {t.statsState.retry}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const items = data?.weakTags ?? [];

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Award className="h-4 w-4" />
                    {t.weakTags.title}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{t.weakTags.subtitle}</p>
            </CardHeader>
            <CardContent>
                {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t.weakTags.empty}</p>
                ) : (
                    <ul className="divide-y">
                        {items.map((item, index) => {
                            const href = item.subjectId
                                ? `/notebooks/${item.subjectId}?tag=${encodeURIComponent(item.tag)}`
                                : undefined;
                            const row = (
                                <>
                                    <div className="flex items-center gap-3 py-2.5">
                                        <span className="w-6 shrink-0 text-center text-sm font-medium text-muted-foreground">
                                            {index + 1}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-baseline gap-2">
                                                <span className="truncate text-sm font-medium">{item.tag}</span>
                                                <span className="shrink-0 text-xs text-muted-foreground">{item.subjectName}</span>
                                            </div>
                                            <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                                                <span>
                                                    {t.weakTags.unmasteredOf
                                                        .replace('{unmastered}', String(item.unmastered))
                                                        .replace('{total}', String(item.total))}
                                                </span>
                                                <span>
                                                    {item.recentAttempted > 0
                                                        ? t.weakTags.recentRate.replace('{rate}', String(Math.round((item.recentCorrect / item.recentAttempted) * 100)))
                                                        : t.weakTags.recentNoPractice}
                                                </span>
                                            </div>
                                            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                                                <div
                                                    className="h-full rounded-full bg-destructive/70"
                                                    style={{ width: `${Math.round(item.unmasteredRatio * 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </>
                            );
                            return href ? (
                                <li key={`${item.tagSet}-${item.subjectId}-${item.tag}`}>
                                    <Link href={href} className="block rounded-md transition-colors hover:bg-accent/50">
                                        {row}
                                    </Link>
                                </li>
                            ) : (
                                <li key={`${item.tagSet}-${item.subjectId}-${item.tag}`}>{row}</li>
                            );
                        })}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
