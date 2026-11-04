"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { parseStatsRange } from "@/lib/stats/stats-range-core";
import type { StatsRange } from "@/lib/stats/stats-range-core";
import type { Notebook } from "@/types/api";

/** 「全部学科」在 Select 中的哨兵值（Radix Select 不允许空字符串 value） */
const ALL_SUBJECTS_VALUE = '__all__';

/** 时间范围选项与对应的翻译 key（stats.*） */
const RANGE_OPTIONS = [
    { value: '7d', key: 'range7d', fallback: 'Last 7 Days' },
    { value: '30d', key: 'range30d', fallback: 'Last 30 Days' },
    { value: '6m', key: 'range6m', fallback: 'Last 6 Months' },
    { value: 'all', key: 'rangeAll', fallback: 'All Time' },
] as const satisfies readonly { value: StatsRange; key: string; fallback: string }[];

/** 统计中心筛选栏：时间范围 + 学科，保存在 URL 中与 ?tab= 共存 */
export function StatsFilterBar() {
    const { t } = useLanguage();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [subjects, setSubjects] = useState<Notebook[]>([]);

    const range = parseStatsRange(searchParams.get("range"));
    const subjectParam = searchParams.get("subject") ?? "";

    useEffect(() => {
        let cancelled = false;
        apiClient.get<Notebook[]>("/api/notebooks")
            .then(result => {
                if (!cancelled) setSubjects(result);
            })
            .catch(err => {
                frontendLogger.warn('[StatsFilterBar]', 'Failed to load subjects for stats filter', { error: err });
            });
        return () => { cancelled = true; };
    }, []);

    const updateParams = (key: string, value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value) params.set(key, value);
        else params.delete(key);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };

    const handleRangeChange = (next: StatsRange) => {
        // 30d 是默认值，URL 中省略
        updateParams("range", next === '30d' ? '' : next);
    };

    const handleSubjectChange = (value: string) => {
        updateParams("subject", value === ALL_SUBJECTS_VALUE ? '' : value);
    };

    return (
        <div className="flex flex-wrap items-center gap-2 mb-4">
            {/* 时间范围 */}
            <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label={t.stats?.timeRange || "Time Range"}>
                {RANGE_OPTIONS.map(opt => {
                    const active = range === opt.value;
                    const text = t.stats?.[opt.key] || opt.fallback;
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            aria-pressed={active}
                            onClick={() => handleRangeChange(opt.value)}
                            className={`rounded-md px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                                active
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {text}
                        </button>
                    );
                })}
            </div>

            {/* 学科筛选 */}
            <Select
                value={subjectParam || ALL_SUBJECTS_VALUE}
                onValueChange={handleSubjectChange}
            >
                <SelectTrigger className="h-8 w-auto min-w-[7rem] text-xs sm:text-sm">
                    <SelectValue placeholder={t.stats?.allSubjects || "All Subjects"} />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL_SUBJECTS_VALUE}>
                        {t.stats?.allSubjects || "All Subjects"}
                    </SelectItem>
                    {subjects.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
