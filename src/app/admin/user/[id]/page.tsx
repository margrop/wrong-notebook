"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/lib/page-title";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { formatDateTime } from "@/lib/date-time";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { Loader2, ArrowLeft, User, BookOpen, PenTool, Layers, Calendar, Tag, CheckCircle, Clock, AlertCircle, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/lib/feedback";
import { AdminUserDetail } from "@/types/api";

export default function AdminUserDetailPage() {
    const { timeZone } = useTimeZone()
    const { data: session, status } = useSession()
    const router = useRouter()
    const params = useParams()
    const { t } = useLanguage()
    const [data, setData] = useState<AdminUserDetail | null>(null)
    usePageTitle(t.admin.dashboard.title, data?.user.name || data?.user.email)
    const [loading, setLoading] = useState(true)
    const [entering, setEntering] = useState(false)

    const userId = params.id as string

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const result = await apiClient.get<AdminUserDetail>(`/api/admin/users/${userId}/detail`)
            setData(result)
        } catch (error) {
            frontendLogger.error('[AdminUserDetail]', 'Failed to fetch user detail', { error })
        } finally {
            setLoading(false)
        }
    }, [userId])

    const enterViewAs = async (destination: string) => {
        setEntering(true)
        try {
            await apiClient.post("/api/admin/view-as", { userId })
            router.push(destination)
            router.refresh()
        } catch (error) {
            frontendLogger.error('[AdminUserDetail]', 'Failed to enter view-as mode', { error })
            toast.error(t.admin?.viewAs?.enterFailed || "Failed to view as this user")
            setEntering(false)
        }
    }

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

    const masteryItems = [
        { key: "new", label: t.admin?.dashboard?.masteryNew || "To Review", count: data.masteryDistribution.new, icon: AlertCircle, color: "text-red-500" },
        { key: "reviewing", label: t.admin?.dashboard?.masteryReviewing || "Reviewing", count: data.masteryDistribution.reviewing, icon: Clock, color: "text-yellow-500" },
        { key: "mastered", label: t.admin?.dashboard?.masteryMastered || "Mastered", count: data.masteryDistribution.mastered, icon: CheckCircle, color: "text-green-500" },
    ]
    const totalMastery = data.masteryDistribution.new + data.masteryDistribution.reviewing + data.masteryDistribution.mastered

    return (
        <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" onClick={() => router.push("/admin")}>
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    {t.common?.back || "Back"}
                </Button>
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-full bg-blue-50 dark:bg-blue-950/30">
                        <User className="h-6 w-6 text-blue-500" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold">{data.user.name || "N/A"}</h1>
                        <p className="text-sm text-muted-foreground">{data.user.email}</p>
                    </div>
                    {data.user.role === "admin" && (
                        <Badge variant="default">{t.admin?.admin || "Admin"}</Badge>
                    )}
                    <Badge variant={data.user.isActive ? "default" : "destructive"}>
                        {data.user.isActive ? (t.admin?.active || "Active") : (t.admin?.disabled || "Disabled")}
                    </Badge>
                </div>
                    <Button variant="outline" size="sm" className="ml-auto" disabled={entering} onClick={() => { void enterViewAs("/notebooks") }}>
                        <Eye className="mr-1 h-4 w-4" />
                        {t.admin?.viewAs?.enter || "View this user's data"}
                    </Button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-4 text-center">
                        <Layers className="h-5 w-5 text-purple-500 mx-auto mb-1" />
                        <div className="text-2xl font-bold">{data.notebookCount}</div>
                        <div className="text-xs text-muted-foreground">{t.admin?.dashboard?.notebooks || "Notebooks"}</div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-4 text-center">
                        <BookOpen className="h-5 w-5 text-red-500 mx-auto mb-1" />
                        <div className="text-2xl font-bold">{data.errorCount}</div>
                        <div className="text-xs text-muted-foreground">{t.admin?.dashboard?.errors || "Errors"}</div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-4 text-center">
                        <PenTool className="h-5 w-5 text-green-500 mx-auto mb-1" />
                        <div className="text-2xl font-bold">{data.practiceCount}</div>
                        <div className="text-xs text-muted-foreground">{t.admin?.dashboard?.practice || "Practice"}</div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-4 text-center">
                        <Calendar className="h-5 w-5 text-blue-500 mx-auto mb-1" />
                        <div className="text-2xl font-bold">{data.recent7DaysCount}</div>
                        <div className="text-xs text-muted-foreground">{t.admin?.dashboard?.recent7Days || "Last 7 Days"}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Notebooks & Mastery */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Notebooks */}
                <Card className="border-0 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Layers className="h-4 w-4 text-purple-500" />
                            {t.admin?.dashboard?.userNotebooks || "Notebooks"}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {data.notebooks.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-4 text-center">
                                {t.admin?.dashboard?.noData || "No Data"}
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {data.notebooks.map((nb) => (
                                    <div key={nb.id} className="flex justify-between items-center p-2 rounded-lg bg-muted/30">
                                        <span className="font-medium text-sm">{nb.name}</span>
                                        <Badge variant="secondary" className="text-xs">{(t.admin?.dashboard?.questionCount || "{count} questions").replace("{count}", String(nb.errorCount))}</Badge>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Mastery */}
                <Card className="border-0 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            {t.admin?.dashboard?.masteryDistribution || "Mastery Distribution"}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {totalMastery === 0 ? (
                            <p className="text-sm text-muted-foreground py-4 text-center">
                                {t.admin?.dashboard?.noData || "No Data"}
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {masteryItems.map((item) => {
                                    const pct = totalMastery > 0 ? Math.round((item.count / totalMastery) * 100) : 0
                                    return (
                                        <div key={item.key} className="space-y-1">
                                            <div className="flex justify-between text-sm items-center">
                                                <span className="flex items-center gap-1.5 font-medium">
                                                    <item.icon className={`h-4 w-4 ${item.color}`} />
                                                    {item.label}
                                                </span>
                                                <span className="text-muted-foreground">{item.count} ({pct}%)</span>
                                            </div>
                                            <div className="w-full bg-muted rounded-full h-2">
                                                <div
                                                    className="h-2 rounded-full bg-current opacity-60 transition-all duration-500"
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
            </div>

            {/* Subject Distribution */}
            {data.subjectDistribution.length > 0 && (
                <Card className="border-0 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Tag className="h-4 w-4 text-blue-500" />
                            {t.admin?.dashboard?.subjectDistribution || "Subject Distribution"}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {data.subjectDistribution.map((s) => (
                                <div key={s.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                                    <span className="font-medium text-sm">{s.name}</span>
                                    <Badge variant="secondary">{s.count}</Badge>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Recent Error Items */}
            <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Eye className="h-4 w-4 text-orange-500" />
                        {t.admin?.dashboard?.recentErrors || "Recent Error Items"}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {data.recentErrorItems.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                            {t.admin?.dashboard?.noData || "No Data"}
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {data.recentErrorItems.map((item) => (
                                <div key={item.id} className="flex items-start justify-between p-3 rounded-lg bg-muted/30 gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">
                                            {item.questionText || item.ocrText || t.admin?.dashboard?.noQuestionText}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1">
                                            {item.subject && (
                                                <Badge variant="outline" className="text-xs">{item.subject.name}</Badge>
                                            )}
                                            {item.masteryStatus === "mastered" && (
                                                <Badge variant="default" className="text-xs">{t.admin?.dashboard?.masteryMastered || "Mastered"}</Badge>
                                            )}
                                            {item.masteryStatus === "reviewing" && (
                                                <Badge variant="secondary" className="text-xs">{t.admin?.dashboard?.masteryReviewing || "Reviewing"}</Badge>
                                            )}
                                            {item.masteryStatus === "new" && (
                                                <Badge variant="outline" className="text-xs">{t.admin?.dashboard?.masteryNew || "To Review"}</Badge>
                                            )}
                                        </div>
                                    </div>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                        {formatDateTime(item.createdAt, 'yyyy-MM-dd', timeZone)}
                                    </span>
                                    <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2" disabled={entering} onClick={() => { void enterViewAs(`/error-items/${item.id}`) }}>
                                        {t.admin?.viewAs?.openItem || "View"}
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
