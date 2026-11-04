"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RotateCcw, Repeat } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { MasteryStatus } from "@/lib/mastery-status";
import { useStatsData } from "@/lib/hooks/use-stats-data";
import { cn } from "@/lib/utils";

export interface RepeatedMistakesItem {
    id: string;
    shortId: string | null;
    subjectName: string | null;
    preview: string | null;
    wrongCount: number;
    lastWrongAt: string;
    masteryStatus: MasteryStatus;
}

export interface RepeatedMistakesData {
    items: RepeatedMistakesItem[];
}

interface RepeatedMistakesCardProps {
    url: string;
}

const MASTERY_BADGE: Record<MasteryStatus, string> = {
    new: "bg-warning/15 text-amber-700 dark:text-warning",
    reviewing: "bg-primary/10 text-primary",
    mastered: "bg-success/15 text-success",
};

/** 练习统计「反复错题目」榜：列出所选范围内做错 2 次以上的题目，提示重点复习 */
export function RepeatedMistakesCard({ url }: RepeatedMistakesCardProps) {
    const { language, t } = useLanguage();
    const { data, loading, error, reload } = useStatsData<RepeatedMistakesData>(url);

    const dateFormatter = new Intl.DateTimeFormat(language, { dateStyle: "medium" });

    const formatDate = (iso: string) => {
        // lastWrongAt 是 'yyyy-MM-dd' 字符串，按本地日历日期解析避免时区错位
        const [year, month, day] = iso.split("-").map(Number);
        return dateFormatter.format(new Date(year, month - 1, day));
    };

    const masteryLabel = (status: MasteryStatus) =>
        status === "mastered" ? t.notebook.mastered : status === "reviewing" ? t.notebook.reviewing : t.notebook.review;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <Repeat className="h-4 w-4" />
                    {t.repeatedMistakes?.title || "Repeated Mistakes"}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{t.repeatedMistakes?.subtitle || "Questions answered wrong 2 or more times in the selected range"}</p>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{t.statsState?.errorDesc || "Failed to load data"}</span>
                        <Button variant="ghost" size="sm" onClick={reload}>
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                            {t.statsState?.retry || "Retry"}
                        </Button>
                    </div>
                ) : !data || data.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t.repeatedMistakes?.empty || "No questions answered wrong 2 or more times in the selected range."}</p>
                ) : (
                    <ul className="divide-y">
                        {data.items.map((item, index) => (
                            <li key={item.id}>
                                <Link href={`/error-items/${item.id}`} className="block rounded-md transition-colors hover:bg-accent/50">
                                    <div className="flex items-center gap-3 py-2.5">
                                        <span className="w-6 shrink-0 text-center text-sm font-medium text-muted-foreground">
                                            {index + 1}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-baseline gap-2">
                                                <span className="truncate text-sm font-medium">
                                                    {item.preview || t.repeatedMistakes?.noPreview || "(No question text)"}
                                                </span>
                                            </div>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                                {item.subjectName && <span>{item.subjectName}</span>}
                                                <span>{formatDate(item.lastWrongAt)}</span>
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            <Badge variant="secondary" className="bg-destructive/10 text-destructive">
                                                {t.repeatedMistakes?.wrongTimes.replace("{count}", String(item.wrongCount)) || `Wrong ${item.wrongCount}×`}
                                            </Badge>
                                            <Badge variant="secondary" className={cn(MASTERY_BADGE[item.masteryStatus])}>
                                                {masteryLabel(item.masteryStatus)}
                                            </Badge>
                                        </div>
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
