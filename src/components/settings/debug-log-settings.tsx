"use client";

import { useCallback, useEffect, useState } from "react";
import { Bug, Download, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/date-time";
import { downloadFile } from "@/lib/download-file";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import type { DebugLogStatus } from "@/lib/debug-log";

const STATUS_URL = "/api/admin/debug-logs";
/** 开启期间定时刷新已记录条数 */
const REFRESH_INTERVAL_MS = 5000;

/** 管理员调试日志：开关调试模式、查看记录条数、导出或清空日志 */
export function DebugLogSettings() {
    const { t } = useLanguage();
    const { timeZone } = useTimeZone();
    const text = t.admin.debugLog;
    const [status, setStatus] = useState<DebugLogStatus | null>(null);
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async () => {
        try {
            setStatus(await apiClient.get<DebugLogStatus>(STATUS_URL));
        } catch (error) {
            frontendLogger.warn('[DebugLogSettings]', 'Failed to load debug status', { error });
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：打开面板时加载调试状态
        refresh();
    }, [refresh]);

    useEffect(() => {
        if (!status?.enabled) return;
        const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [status?.enabled, refresh]);

    const runAction = async (action: () => Promise<void>, successText: string) => {
        setBusy(true);
        try {
            await action();
            toast.success(successText);
        } catch (error) {
            frontendLogger.error('[DebugLogSettings]', 'Debug log action failed', { error });
            toast.error(text.failed);
        } finally {
            setBusy(false);
        }
    };

    const handleToggle = (enabled: boolean) => runAction(async () => {
        setStatus(await apiClient.post<DebugLogStatus>(STATUS_URL, { enabled }));
    }, enabled ? text.enabled : text.disabled);

    const handleClear = () => runAction(async () => {
        setStatus(await apiClient.delete<DebugLogStatus>(STATUS_URL));
    }, text.cleared);

    const handleExport = () => runAction(async () => {
        await downloadFile(`${STATUS_URL}/export`, "wrong-notebook-debug.json");
        await refresh();
    }, text.exported);

    const format = (iso: string | null) => (iso ? formatDateTime(iso, 'yyyy-MM-dd HH:mm', timeZone) : '');
    const hint = status?.enabled
        ? text.enabledHint.replace('{since}', format(status.enabledAt)).replace('{until}', format(status.expiresAt))
        : text.disabledHint;
    const hasEntries = (status?.entryCount ?? 0) > 0;

    return (
        <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <Label htmlFor="debug-mode-switch" className="flex items-center gap-2 font-medium">
                        <Bug className="h-4 w-4" />
                        {text.title}
                    </Label>
                    <p className="text-xs text-muted-foreground">{text.desc}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm text-muted-foreground">{text.enable}</span>
                    <Switch
                        id="debug-mode-switch"
                        checked={!!status?.enabled}
                        onCheckedChange={handleToggle}
                        disabled={busy || !status}
                    />
                </div>
            </div>

            <p className={`text-xs ${status?.enabled ? "text-orange-600" : "text-muted-foreground"}`}>
                {hint}
                {status && (
                    <>
                        {" "}{text.entries.replace('{count}', String(status.entryCount))}
                        {status.droppedCount > 0 && text.dropped.replace('{count}', String(status.droppedCount))}
                    </>
                )}
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" size="sm" onClick={handleExport} disabled={busy || !hasEntries} className="sm:flex-1">
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                    {text.export}
                </Button>
                <Button variant="outline" size="sm" onClick={handleClear} disabled={busy || !hasEntries}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {text.clear}
                </Button>
            </div>

            <p className="text-xs text-muted-foreground">{text.privacyNote}</p>
        </div>
    );
}
