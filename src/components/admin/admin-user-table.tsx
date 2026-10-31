"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { formatDateTime } from "@/lib/date-time";
import type { AdminUserStats } from "@/types/api";

/** 管理员仪表盘的用户列表：可展开查看每个用户的使用统计 */
export function UserTable({ users, onViewDetail }: { users: AdminUserStats[]; onViewDetail: (userId: string) => void }) {
    const { timeZone } = useTimeZone()
    const { t } = useLanguage()
    const [expandedId, setExpandedId] = useState<string | null>(null)

    return (
        <div className="space-y-3">
            {/* 桌面端表格 */}
            <div className="hidden md:block border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                        <tr>
                            <th className="text-left p-3 font-medium">{t.admin?.dashboard?.userName || "Username"}</th>
                            <th className="text-left p-3 font-medium">{t.admin?.dashboard?.email || "Email"}</th>
                            <th className="text-center p-3 font-medium">{t.admin?.dashboard?.notebooks || "Notebooks"}</th>
                            <th className="text-center p-3 font-medium">{t.admin?.dashboard?.errors || "Errors"}</th>
                            <th className="text-center p-3 font-medium">{t.admin?.dashboard?.practice || "Practice"}</th>
                            <th className="text-center p-3 font-medium">{t.admin?.dashboard?.status || "Status"}</th>
                            <th className="text-center p-3 font-medium">{t.admin?.dashboard?.registeredAt || "Registered At"}</th>
                            <th className="text-center p-3 font-medium">{t.admin?.dashboard?.actions || "Actions"}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((user) => (
                            <tr key={user.id} className="border-t hover:bg-muted/30 transition-colors">
                                <td className="p-3">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{user.name || "N/A"}</span>
                                        {user.role === "admin" && (
                                            <Badge variant="default" className="text-xs">{t.admin?.admin || "Admin"}</Badge>
                                        )}
                                    </div>
                                </td>
                                <td className="p-3 text-muted-foreground">{user.email}</td>
                                <td className="p-3 text-center">{user.notebookCount}</td>
                                <td className="p-3 text-center font-medium">{user.errorCount}</td>
                                <td className="p-3 text-center">{user.practiceCount}</td>
                                <td className="p-3 text-center">
                                    <Badge variant={user.isActive ? "default" : "destructive"} className="text-xs">
                                        {user.isActive ? (t.admin?.active || "Active") : (t.admin?.disabled || "Disabled")}
                                    </Badge>
                                </td>
                                <td className="p-3 text-center text-muted-foreground text-xs">
                                    {formatDateTime(user.createdAt, 'yyyy-MM-dd', timeZone)}
                                </td>
                                <td className="p-3 text-center">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => onViewDetail(user.id)}
                                        title={t.admin?.dashboard?.viewDetail || "View Detail"}
                                    >
                                        <Eye className="h-4 w-4" />
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* 移动端卡片 */}
            <div className="md:hidden space-y-3">
                {users.map((user) => (
                    <Card key={user.id} className="border-0 shadow-sm">
                        <CardContent className="p-4">
                            <div
                                className="flex justify-between items-start cursor-pointer"
                                onClick={() => setExpandedId(expandedId === user.id ? null : user.id)}
                            >
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{user.name || "N/A"}</span>
                                        {user.role === "admin" && (
                                            <Badge variant="default" className="text-xs">{t.admin?.admin || "Admin"}</Badge>
                                        )}
                                    </div>
                                    <div className="text-sm text-muted-foreground">{user.email}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge variant={user.isActive ? "default" : "destructive"} className="text-xs">
                                        {user.isActive ? (t.admin?.active || "Active") : (t.admin?.disabled || "Disabled")}
                                    </Badge>
                                    {expandedId === user.id ? (
                                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </div>
                            </div>
                            {expandedId === user.id && (
                                <div className="mt-3 pt-3 border-t grid grid-cols-3 gap-3 text-center">
                                    <div>
                                        <div className="text-lg font-bold">{user.notebookCount}</div>
                                        <div className="text-xs text-muted-foreground">{t.admin?.dashboard?.notebooks || "Notebooks"}</div>
                                    </div>
                                    <div>
                                        <div className="text-lg font-bold text-red-500">{user.errorCount}</div>
                                        <div className="text-xs text-muted-foreground">{t.admin?.dashboard?.errors || "Errors"}</div>
                                    </div>
                                    <div>
                                        <div className="text-lg font-bold text-green-500">{user.practiceCount}</div>
                                        <div className="text-xs text-muted-foreground">{t.admin?.dashboard?.practice || "Practice"}</div>
                                    </div>
                                </div>
                            )}
                            {expandedId === user.id && (
                                <div className="mt-3 pt-3 border-t flex justify-between items-center">
                                    <span className="text-xs text-muted-foreground">
                                        {formatDateTime(user.createdAt, 'yyyy-MM-dd', timeZone)}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => onViewDetail(user.id)}
                                    >
                                        <Eye className="h-4 w-4 mr-1" />
                                        {t.admin?.dashboard?.viewDetail || "View Detail"}
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    )
}
