"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { EulaSummary } from "@/components/eula/eula-summary";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import type { EulaStatus } from "@/lib/eula/types";

interface EulaUpgradeDialogProps {
    status: EulaStatus;
    onAccept: () => Promise<void>;
}

/** 协议升级后的全屏门禁（只对管理员显示）：不能关闭，只能同意或退出登录 */
export function EulaUpgradeDialog({ status, onAccept }: EulaUpgradeDialogProps) {
    const { t, language } = useLanguage();
    const [busy, setBusy] = useState(false);
    const changes = language === "en" ? status.changes.en : status.changes.zh;

    const handleAccept = async () => {
        setBusy(true);
        try {
            await onAccept();
        } catch (error) {
            frontendLogger.error("[EulaGate]", "Failed to accept EULA", { error });
            toast.error(t.eula.acceptFailed);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="eula-upgrade-title">
            <div className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-lg border bg-background p-5 shadow-lg">
                <h2 id="eula-upgrade-title" className="text-lg font-semibold">{t.eula.upgradeTitle}</h2>
                <p className="text-sm text-muted-foreground">
                    {t.eula.upgradeDesc.replace("{accepted}", status.accepted ?? "-").replace("{current}", status.current)}
                </p>
                {changes.length > 0 && (
                    <div className="space-y-1">
                        <p className="text-sm font-medium">{t.eula.changesTitle}</p>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                            {changes.map((line) => <li key={line}>{line}</li>)}
                        </ul>
                    </div>
                )}
                <EulaSummary />
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button variant="outline" onClick={() => signOut({ callbackUrl: "/login" })} disabled={busy}>
                        {t.eula.logout}
                    </Button>
                    <Button onClick={handleAccept} disabled={busy}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {t.eula.accept}
                    </Button>
                </div>
            </div>
        </div>
    );
}
