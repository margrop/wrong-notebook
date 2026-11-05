"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { EulaConsentDialog } from "@/components/eula/eula-consent-dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { acceptEulaAndEnableForwarding, fetchTelemetryNotice, updateTelemetry } from "@/lib/hooks/use-telemetry-admin";

interface TelemetryNoticeBannerProps {
    /** 只对管理员显示 */
    enabled: boolean;
}

/** 存量实例的一次性告知：外发默认关闭，管理员可查看协议后开启，或选择不再提示 */
export function TelemetryNoticeBanner({ enabled }: TelemetryNoticeBannerProps) {
    const { t } = useLanguage();
    const text = t.telemetrySettings;
    const [visible, setVisible] = useState(false);
    const [eulaVersion, setEulaVersion] = useState("");
    const [consentOpen, setConsentOpen] = useState(false);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        fetchTelemetryNotice()
            .then((status) => {
                if (cancelled) return;
                setEulaVersion(status.eula.current);
                setVisible(status.showNotice);
            })
            .catch((error) => frontendLogger.warn("[TelemetryNotice]", "Failed to load telemetry notice", { error }));
        return () => { cancelled = true; };
    }, [enabled]);

    if (!enabled || !visible) return null;

    const dismiss = () => {
        setVisible(false);
        updateTelemetry({ noticeDismissed: true })
            .catch((error) => frontendLogger.warn("[TelemetryNotice]", "Failed to dismiss notice", { error }));
    };
    const enable = async () => {
        try {
            await acceptEulaAndEnableForwarding(eulaVersion);
            setVisible(false);
            toast.success(text.enabled);
        } catch (error) {
            frontendLogger.error("[TelemetryNotice]", "Failed to enable forwarding", { error });
            toast.error(text.failed);
            throw error;
        }
    };

    return (
        <div className="border-b bg-primary/5 print:hidden">
            <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2 text-sm sm:flex-row sm:items-center md:px-8">
                <p className="flex-1 text-muted-foreground">{text.noticeText}</p>
                <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" onClick={() => setConsentOpen(true)}>{text.noticeEnable}</Button>
                    <Button size="sm" variant="ghost" onClick={dismiss}>
                        <X className="mr-1 h-4 w-4" />
                        {text.noticeDismiss}
                    </Button>
                </div>
            </div>
            <EulaConsentDialog open={consentOpen} onOpenChange={setConsentOpen} onConfirm={enable} />
        </div>
    );
}
