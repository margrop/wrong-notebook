"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OverviewCards, DailyTrendChart, SubjectDistributionChart, MasteryDistributionCard } from "@/components/admin/dashboard-charts";
import { UserTable } from "@/components/admin/admin-user-table";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { usePageTitle } from "@/lib/page-title";
import type { AdminDashboardData } from "@/types/api";

export default function AdminPage() {
    const { data: session, status } = useSession()
    const router = useRouter()
    const { t } = useLanguage()
    const [data, setData] = useState<AdminDashboardData | null>(null)
    usePageTitle(t.admin.dashboard.title)
    const [loading, setLoading] = useState(true)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const result = await apiClient.get<AdminDashboardData>("/api/admin/dashboard")
            setData(result)
        } catch (error) {
            frontendLogger.error('[AdminDashboard]', 'Failed to fetch dashboard data', { error })
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        if (status === "loading") return
        if (!session?.user || session.user.role !== "admin") {
            router.push("/")
            return
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面或条件变化时加载，请求前后更新加载状态和结果
        fetchData()
    }, [session, status, router, fetchData])

    if (status === "loading" || loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!data) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <p className="text-muted-foreground">{t.common?.error || "Error"}</p>
                <Button onClick={fetchData}>{t.admin?.dashboard?.retry || "Retry"}</Button>
            </div>
        )
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6 px-4 py-6 md:px-8 md:py-8">
            <PageHeader
                title={t.admin?.dashboard?.title || "Admin Dashboard"}
                description={t.admin?.dashboard?.subtitle || "View all users and error statistics"}
            />

            {/* Overview Cards */}
            <OverviewCards data={data} t={t} />

            {/* Charts Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DailyTrendChart data={data} t={t} />
                <MasteryDistributionCard data={data} t={t} />
            </div>

            {/* Subject Distribution */}
            <SubjectDistributionChart data={data} t={t} />

            {/* User List */}
            <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Users className="h-5 w-5 text-blue-500" />
                        {t.admin?.dashboard?.userList || "User List"}
                    </CardTitle>
                    <CardDescription>
                        {t.admin?.dashboard?.userListDesc || "All registered users and their error entry status"}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <UserTable
                        users={data.userStats}
                        onViewDetail={(userId) => router.push(`/admin/user/${userId}`)}
                    />
                </CardContent>
            </Card>
        </div>
    )
}
