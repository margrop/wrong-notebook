"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/lib/page-title";
import { WrongAnswerStats } from "@/components/stats/wrong-answer-stats";
import { PracticeStats } from "@/components/stats/practice-stats";
import { ActivityHeatmap } from "@/components/stats/activity-heatmap";
import { RepeatedMistakesCard } from "@/components/stats/repeated-mistakes-card";
import { TagManagement } from "@/components/tags/tag-management";
import { StatsFilterBar } from "@/components/stats/stats-filter-bar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { TrendingUp, Activity, Tags } from "lucide-react";
import { parseStatsRange } from "@/lib/stats/stats-range-core";

const STATS_TABS = ["wrong", "practice", "tags"] as const;
type StatsTab = typeof STATS_TABS[number];

function isStatsTab(value: string | null): value is StatsTab {
    return STATS_TABS.includes(value as StatsTab);
}

/** 统计中心 Tab，当前 Tab 记录在 ?tab= 中，便于直达和刷新后保持 */
function StatsTabs() {
    const { t } = useLanguage();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const tabParam = searchParams.get("tab");
    // 旧链接 ?tab=tag-stats 映射到 tags
    const normalizedTab = tabParam === "tag-stats" ? "tags" : tabParam;
    const tab: StatsTab = isStatsTab(normalizedTab) ? normalizedTab : "wrong";

    const handleTabChange = (value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value === "wrong") params.delete("tab");
        else params.set("tab", value);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };

    const range = parseStatsRange(searchParams.get("range"));
    const subjectParam = searchParams.get("subject") ?? "";

    const buildUrl = (base: string) => {
        const params = new URLSearchParams();
        if (range !== '30d') params.set("range", range);
        if (subjectParam) params.set("subjectId", subjectParam);
        const qs = params.toString();
        return qs ? `${base}?${qs}` : base;
    };

    return (
        <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="mb-4 grid h-auto w-full grid-cols-3 gap-1 sm:inline-flex sm:h-10 sm:w-auto">
                <TabsTrigger value="wrong" className="flex items-center justify-center gap-1.5 whitespace-normal text-center leading-tight sm:gap-2 sm:whitespace-nowrap">
                    <Activity className="h-4 w-4 shrink-0" />
                    {t.wrongAnswerStats?.title || "Wrong Answer Stats"}
                </TabsTrigger>
                <TabsTrigger value="practice" className="flex items-center justify-center gap-1.5 whitespace-normal text-center leading-tight sm:gap-2 sm:whitespace-nowrap">
                    <TrendingUp className="h-4 w-4 shrink-0" />
                    {t.stats?.title || "Practice Stats"}
                </TabsTrigger>
                <TabsTrigger value="tags" className="flex items-center justify-center gap-1.5 whitespace-normal text-center leading-tight sm:gap-2 sm:whitespace-nowrap">
                    <Tags className="h-4 w-4 shrink-0" />
                    {t.stats?.tagManagement || "Knowledge Points"}
                </TabsTrigger>
            </TabsList>

            {tab !== "tags" && <StatsFilterBar />}

            <TabsContent value="wrong" className="space-y-4">
                <WrongAnswerStats
                    url={buildUrl("/api/analytics")}
                    weakTagsUrl={buildUrl("/api/stats/weak-tags")}
                    subjectId={subjectParam || undefined}
                />
            </TabsContent>
            <TabsContent value="practice" className="space-y-4">
                {/* 学习日历只受学科筛选影响；与练习统计并列，练习统计为空时也显示（录入错题也算活动） */}
                <ActivityHeatmap url={subjectParam ? `/api/stats/activity?subjectId=${encodeURIComponent(subjectParam)}` : "/api/stats/activity"} />
                <PracticeStats url={buildUrl("/api/stats/practice")} />
                {/* 反复错题目榜：练习统计为空时也照常显示 */}
                <RepeatedMistakesCard url={buildUrl("/api/stats/repeated-mistakes")} />
            </TabsContent>
            <TabsContent value="tags" className="space-y-4">
                <TagManagement />
            </TabsContent>
        </Tabs>
    );
}

export default function StatsPage() {
    const { t } = useLanguage();
    usePageTitle(t.stats.headerTitle);

    return (
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8 md:py-8">
            <PageHeader
                title={t.stats?.headerTitle || "Statistics Center"}
                description={t.stats?.headerDesc || "View your learning progress, data analysis and knowledge points"}
            />
            <Suspense fallback={null}>
                <StatsTabs />
            </Suspense>
        </main>
    );
}
