"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { confirmDialog, toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";

type DangerAction = 'migrateTags' | 'clearPractice' | 'clearErrors' | 'systemReset';

interface DangerZoneSettingsProps {
    isAdmin: boolean;
}

interface ActionCardProps {
    title: ReactNode;
    description: string;
    tone: 'info' | 'danger' | 'critical';
    busy: boolean;
    icon: ReactNode;
    onClick: () => void;
}

const TONES = {
    info: { card: "border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40", title: "text-blue-900 dark:text-blue-200 font-bold", desc: "text-blue-800 dark:text-blue-200 font-medium", button: "bg-blue-100 dark:bg-blue-900/40 hover:bg-blue-200 dark:hover:bg-blue-900/60 text-blue-900 dark:text-blue-200 border-blue-300 dark:border-blue-800" },
    danger: { card: "border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40", title: "text-red-700 dark:text-red-300 font-medium", desc: "text-red-600 dark:text-red-400", button: "" },
    critical: { card: "border-red-600/50 bg-red-100/50 dark:bg-red-900/40", title: "text-red-900 dark:text-red-200 font-bold", desc: "text-red-800 dark:text-red-200 font-medium", button: "bg-red-700 hover:bg-red-800" },
};

function ActionCard({ title, description, tone, busy, icon, onClick }: ActionCardProps) {
    const style = TONES[tone];
    return (
        <div className={`p-4 border rounded-lg ${style.card}`}>
            <div className="flex items-center justify-between">
                <span className={`text-sm flex items-center gap-2 ${style.title}`}>{title}</span>
                <Button
                    variant={tone === 'info' ? "outline" : "destructive"}
                    size="sm"
                    onClick={onClick}
                    disabled={busy}
                    className={style.button}
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
                </Button>
            </div>
            <p className={`text-xs mt-2 ${style.desc}`}>{description}</p>
        </div>
    );
}

/** 危险操作：清空练习记录与错题；管理员可重置系统标签和初始化系统 */
export function DangerZoneSettings({ isAdmin }: DangerZoneSettingsProps) {
    const { t } = useLanguage();
    const [running, setRunning] = useState<DangerAction | null>(null);

    /** 执行操作，成功后提示；reload 为 true 时刷新页面 */
    const run = async (action: DangerAction, request: () => Promise<string>, failedText: string, reload: boolean) => {
        setRunning(action);
        try {
            toast.success(await request());
            if (reload) window.location.reload();
        } catch (error) {
            frontendLogger.error('[DangerZoneSettings]', `${action} failed`, { error });
            toast.error(failedText);
        } finally {
            setRunning(null);
        }
    };

    const success = t.settings?.clearSuccess || "Success";
    const failed = t.settings?.clearError || "Failed";

    const handleMigrateTags = async () => {
        if (!(await confirmDialog(t.settings?.migrateTagsConfirm || "This will reset system tags. Confirm?", { destructive: true }))) return;
        await run('migrateTags', async () => {
            const res = await apiClient.post<{ count?: number }>("/api/admin/migrate-tags", {});
            return `${success}: ${res.count || 0} tags migrated.`;
        }, t.settings?.clearError || "Failed to migrate tags", false);
    };

    const handleClearPractice = async () => {
        if (!(await confirmDialog(t.settings?.clearDataConfirm || "Are you sure?", { destructive: true }))) return;
        await run('clearPractice', async () => {
            await apiClient.delete("/api/stats/practice/clear");
            return success;
        }, failed, true);
    };

    const handleClearErrors = async () => {
        if (!(await confirmDialog(t.settings?.clearErrorDataConfirm || "Are you sure?", { destructive: true }))) return;
        await run('clearErrors', async () => {
            await apiClient.delete("/api/error-items/clear");
            return success;
        }, failed, true);
    };

    const handleSystemReset = async () => {
        if (!(await confirmDialog(t.settings?.systemResetConfirm || "WARNING: Deleting ALL data. Undoing is impossible. Are you sure?", { destructive: true }))) return;
        // 再次确认：需要输入 RESET
        const userInput = prompt(t.settings?.systemResetPrompt || "Type 'RESET' to confirm system initialization:", "");
        if (userInput !== 'RESET') {
            if (userInput !== null) toast.error(t.common?.error || "Confirmation failed");
            return;
        }
        await run('systemReset', async () => {
            await apiClient.post("/api/admin/system-reset", {});
            return t.settings?.clearSuccess || "Success - System Reset Complete";
        }, t.settings?.clearError || "Failed to reset system", true);
    };

    return (
        <>
            {isAdmin && (
                <ActionCard
                    tone="info"
                    title={<><RefreshCw className="h-4 w-4" />{t.settings?.migrateTags || "Migrate Tags"}</>}
                    description={t.settings?.migrateTagsDesc || 'Re-populates standard tags from file'}
                    busy={running === 'migrateTags'}
                    icon={<RefreshCw className="h-4 w-4" />}
                    onClick={handleMigrateTags}
                />
            )}
            <ActionCard
                tone="danger"
                title={t.settings?.clearData || "Clear Practice Data"}
                description={t.settings?.clearDataDesc || 'This will permanently delete all practice history. Irreversible.'}
                busy={running === 'clearPractice'}
                icon={<Trash2 className="h-4 w-4" />}
                onClick={handleClearPractice}
            />
            <ActionCard
                tone="danger"
                title={t.settings?.clearErrorData || "Clear Error Data"}
                description={t.settings?.clearErrorDataDesc || 'This will permanently delete all error items. Irreversible.'}
                busy={running === 'clearErrors'}
                icon={<Trash2 className="h-4 w-4" />}
                onClick={handleClearErrors}
            />
            {isAdmin && (
                <ActionCard
                    tone="critical"
                    title={<><AlertTriangle className="h-4 w-4" />{t.settings?.systemReset || "System Initialization"}</>}
                    description={t.settings?.systemResetDesc || 'Resets the system to factory state. Deletes ALL data.'}
                    busy={running === 'systemReset'}
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={handleSystemReset}
                />
            )}
        </>
    );
}
