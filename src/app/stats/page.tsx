"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/lib/page-title";
import { WrongAnswerStats } from "@/components/stats/wrong-answer-stats";
import { PracticeStats } from "@/components/stats/practice-stats";
import { TagUsageStats } from "@/components/tags/tag-usage-stats";
import { TagManagement } from "@/components/tags/tag-management";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { TrendingUp, Activity, BarChart3, Tags } from "lucide-react";

const STATS_TABS = ["wrong", "practice", "tag-stats", "tags"] as const;
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
    const tab: StatsTab = isStatsTab(tabParam) ? tabParam : "wrong";

    const handleTabChange = (value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value === "wrong") params.delete("tab");
        else params.set("tab", value);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };

    return (
        <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="mb-6 grid h-auto w-full grid-cols-2 gap-1 sm:inline-flex sm:h-10 sm:w-auto">
                <TabsTrigger value="wrong" className="flex items-center justify-center gap-1.5 whitespace-normal text-center leading-tight sm:gap-2 sm:whitespace-nowrap">
                    <Activity className="h-4 w-4 shrink-0" />
                    {t.wrongAnswerStats?.title || "Wrong Answer Stats"}
                </TabsTrigger>
                <TabsTrigger value="practice" className="flex items-center justify-center gap-1.5 whitespace-normal text-center leading-tight sm:gap-2 sm:whitespace-nowrap">
                    <TrendingUp className="h-4 w-4 shrink-0" />
                    {t.stats?.title || "Practice Stats"}
                </TabsTrigger>
                <TabsTrigger value="tag-stats" className="flex items-center justify-center gap-1.5 whitespace-normal text-center leading-tight sm:gap-2 sm:whitespace-nowrap">
                    <BarChart3 className="h-4 w-4 shrink-0" />
                    {t.stats?.tagStats || "Knowledge Point Stats"}
                </TabsTrigger>
                <TabsTrigger value="tags" className="flex items-center justify-center gap-1.5 whitespace-normal text-center leading-tight sm:gap-2 sm:whitespace-nowrap">
                    <Tags className="h-4 w-4 shrink-0" />
                    {t.stats?.tagManagement || "Knowledge Points"}
                </TabsTrigger>
            </TabsList>

            <TabsContent value="wrong" className="space-y-4">
                <WrongAnswerStats />
            </TabsContent>
            <TabsContent value="practice" className="space-y-4">
                <PracticeStats />
            </TabsContent>
            <TabsContent value="tag-stats" className="space-y-4">
                <TagUsageStats />
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
