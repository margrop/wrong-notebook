"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { formatDateTime } from "@/lib/date-time";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Trash2, Ban, CheckCircle, Loader2 } from "lucide-react";
import { AiConcurrencyLimitSetting } from "@/components/admin/ai-concurrency-limit-setting";
import { AiUsageToday } from "@/components/admin/ai-usage-today";
import { apiClient } from "@/lib/api-client";
import { AdminUser, AppConfig } from "@/types/api";
import { toast, confirmDialog } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { getApiErrorMessage } from "@/lib/error-message";

export function UserManagement() {
    const { timeZone } = useTimeZone();
    const { data: session } = useSession();
    const { t } = useLanguage();
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [allowRegistration, setAllowRegistration] = useState(false);
    const [savingRegistration, setSavingRegistration] = useState(false);
    const [aiDailyLimit, setAiDailyLimit] = useState("0");
    const [savingLimit, setSavingLimit] = useState(false);

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            const data = await apiClient.get<AdminUser[]>("/api/admin/users");
            setUsers(data);
        } catch (error) {
            frontendLogger.error('[UserManagement]', 'Failed to fetch users', { error });
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchConfig = useCallback(async () => {
        try {
            const data = await apiClient.get<AppConfig>("/api/settings");
            setAllowRegistration(data.allowRegistration === true);
            setAiDailyLimit(String(data.aiDailyLimit ?? 0));
        } catch (error) {
            frontendLogger.error('[UserManagement]', 'Failed to fetch config', { error });
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面或条件变化时加载，请求前后更新加载状态和结果
        fetchUsers();
        fetchConfig();
    }, [fetchUsers, fetchConfig]);

    const handleToggleRegistration = async (checked: boolean) => {
        setSavingRegistration(true);
        try {
            await apiClient.post("/api/settings", { allowRegistration: checked });
            setAllowRegistration(checked);
        } catch (error) {
            frontendLogger.error('[UserManagement]', 'Failed to update registration setting', { error });
            toast.error(t.common.error);
        } finally {
            setSavingRegistration(false);
        }
    };

    const parsedLimit = Number(aiDailyLimit);
    const limitValid = aiDailyLimit.trim() !== "" && Number.isInteger(parsedLimit) && parsedLimit >= 0;

    const handleSaveLimit = async () => {
        if (!limitValid) return;
        setSavingLimit(true);
        try {
            await apiClient.post("/api/settings", { aiDailyLimit: parsedLimit });
            toast.success(t.admin.aiDailyLimitSaved);
        } catch (error) {
            frontendLogger.error('[UserManagement]', 'Failed to update AI daily limit', { error });
            toast.error(t.common.error);
        } finally {
            setSavingLimit(false);
        }
    };

    const handleToggleStatus = async (user: AdminUser) => {
        const confirmMsg = user.isActive
            ? t.admin.confirmDisable
            : t.admin.confirmEnable;

        if (!(await confirmDialog(confirmMsg))) return;

        try {
            await apiClient.patch(`/api/admin/users/${user.id}`, { isActive: !user.isActive });
            fetchUsers();
        } catch (error) {
            frontendLogger.error('[UserManagement]', 'Failed to update user status', { error });
            toast.error(t.common.error);
        }
    };

    const handleDelete = async (user: AdminUser) => {
        if (!(await confirmDialog(t.admin.confirmDelete, { destructive: true }))) return;

        try {
            await apiClient.delete(`/api/admin/users/${user.id}`);
            fetchUsers();
        } catch (error) {
            frontendLogger.error('[UserManagement]', 'Failed to delete user', { error });
            const text = getApiErrorMessage(error) || t.common.error;
            toast.error(text);
        }
    };

    if (loading) {
        return <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
    }

    return (
        <div className="space-y-4">
            {/* 注册开关 */}
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
                <div className="space-y-0.5">
                    <Label className="text-base">
                        {t.admin?.allowRegistration || "Allow New Registrations"}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                        {t.admin?.allowRegistrationDesc || "When disabled, new users cannot register"}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {savingRegistration && <Loader2 className="h-4 w-4 animate-spin" />}
                    <Switch
                        checked={allowRegistration}
                        onCheckedChange={handleToggleRegistration}
                        disabled={savingRegistration}
                    />
                </div>
            </div>

            {/* 每日 AI 次数 */}
            <div className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/30 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-0.5">
                    <Label htmlFor="ai-daily-limit" className="text-base">{t.admin.aiDailyLimit}</Label>
                    <p className="text-sm text-muted-foreground">{t.admin.aiDailyLimitDesc}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <Input
                        id="ai-daily-limit"
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        value={aiDailyLimit}
                        onChange={(e) => setAiDailyLimit(e.target.value)}
                        aria-invalid={!limitValid}
                        className="w-24"
                    />
                    <Button size="sm" onClick={handleSaveLimit} disabled={savingLimit || !limitValid}>
                        {savingLimit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {t.common.save}
                    </Button>
                </div>
            </div>

            {/* 同一模型的 AI 并发上限 */}
            <AiConcurrencyLimitSetting />

            {/* 移动端卡片视图 */}
            <div className="sm:hidden space-y-3">
                {users.map((user) => (
                    <div key={user.id} className="border rounded-lg p-4 bg-card space-y-3">
                        <div className="flex justify-between items-start">
                            <div>
                                <div className="font-medium">{user.name || "N/A"}</div>
                                <div className="text-sm text-muted-foreground">{user.email}</div>
                            </div>
                            <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                                {user.role === "admin" ? t.admin.admin : t.admin.user}
                            </Badge>
                        </div>
                        <div className="flex justify-between text-sm">
                            <div className="text-muted-foreground">
                                {t.admin.errors}: {user._count.errorItems} | {t.admin.practiceCount}: {user._count.practiceRecords} | <AiUsageToday user={user} />
                            </div>
                            <Badge variant={user.isActive ? "default" : "destructive"} className="text-xs">
                                {user.isActive ? t.admin.active : t.admin.disabled}
                            </Badge>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t">
                            <div className="text-xs text-muted-foreground">
                                {formatDateTime(user.createdAt, 'yyyy-MM-dd', timeZone)}
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleToggleStatus(user)}
                                    disabled={user.id === session?.user?.id}
                                >
                                    {user.isActive ? (
                                        <Ban className="h-4 w-4 text-orange-500" />
                                    ) : (
                                        <CheckCircle className="h-4 w-4 text-green-500" />
                                    )}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDelete(user)}
                                    disabled={user.id === session?.user?.id}
                                >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* 桌面端表格视图 */}
            <div className="hidden sm:block border rounded-lg overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t.admin.nameEmail}</TableHead>
                            <TableHead>{t.admin.role}</TableHead>
                            <TableHead>{t.admin.stats}</TableHead>
                            <TableHead>{t.admin.createdAt}</TableHead>
                            <TableHead>{t.admin.status}</TableHead>
                            <TableHead className="text-right">{t.admin.actions}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {users.map((user) => (
                            <TableRow key={user.id}>
                                <TableCell>
                                    <div className="font-medium">{user.name || "N/A"}</div>
                                    <div className="text-sm text-muted-foreground">{user.email}</div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                                        {user.role === "admin" ? t.admin.admin : t.admin.user}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="text-sm">
                                        {t.admin.errors}: {user._count.errorItems}
                                    </div>
                                    <div className="text-sm">
                                        {t.admin.practiceCount}: {user._count.practiceRecords}
                                    </div>
                                    <div className="text-sm">
                                        <AiUsageToday user={user} />
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {formatDateTime(user.createdAt, 'yyyy-MM-dd', timeZone)}
                                </TableCell>
                                <TableCell>
                                    <Badge variant={user.isActive ? "default" : "destructive"}>
                                        {user.isActive ? t.admin.active : t.admin.disabled}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right space-x-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleToggleStatus(user)}
                                        disabled={user.id === session?.user?.id}
                                        title={user.isActive ? t.admin.disable : t.admin.enable}
                                    >
                                        {user.isActive ? (
                                            <Ban className="h-4 w-4 text-orange-500" />
                                        ) : (
                                            <CheckCircle className="h-4 w-4 text-green-500" />
                                        )}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDelete(user)}
                                        disabled={user.id === session?.user?.id}
                                        title={t.admin.delete}
                                    >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
