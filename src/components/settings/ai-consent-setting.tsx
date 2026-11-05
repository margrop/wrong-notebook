"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { privacyPolicyUrl } from "@/lib/ai-consent";
import { apiClient } from "@/lib/api-client";
import { confirmDialog, toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";

interface ConsentResponse {
    aiDataConsentAt: string | null;
}

/** 账户设置中的 AI 数据授权：查看状态、同意或撤回 */
export function AiConsentSetting() {
    const { t, language } = useLanguage();
    const text = t.aiConsent;
    const [consentAt, setConsentAt] = useState<string | null | undefined>(undefined);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        apiClient.get<{ aiDataConsentAt?: string | null }>("/api/user")
            .then((profile) => {
                if (!cancelled) setConsentAt(profile?.aiDataConsentAt ?? null);
            })
            .catch((error) => frontendLogger.error("[AiConsentSetting]", "load consent failed", { error }));
        return () => {
            cancelled = true;
        };
    }, []);

    const update = async (grant: boolean) => {
        if (!grant && !(await confirmDialog(text.revokeConfirm, { destructive: true }))) return;
        setSaving(true);
        try {
            const result = grant
                ? await apiClient.post<ConsentResponse>("/api/user/ai-consent", {})
                : await apiClient.delete<ConsentResponse>("/api/user/ai-consent");
            setConsentAt(result.aiDataConsentAt);
            toast.success(grant ? text.agreed : text.revoked);
        } catch (error) {
            frontendLogger.error("[AiConsentSetting]", "update consent failed", { error });
            toast.error(text.failed);
        } finally {
            setSaving(false);
        }
    };

    if (consentAt === undefined) return null;

    const granted = consentAt !== null;
    const date = granted ? new Date(consentAt).toLocaleDateString(language === "en" ? "en-US" : "zh-CN") : "";

    return (
        <div className="space-y-2 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4" />
                    {text.settingTitle}
                </span>
                <Button type="button" size="sm" variant={granted ? "outline" : "default"} onClick={() => update(!granted)} disabled={saving}>
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {granted ? text.revoke : text.grant}
                </Button>
            </div>
            <p className="text-xs text-muted-foreground">
                {granted ? text.settingGranted.replace("{date}", date) : text.settingNotGranted}{" "}
                <a className="underline underline-offset-2" href={privacyPolicyUrl(language)} target="_blank" rel="noopener noreferrer">{text.policyLink}</a>
            </p>
        </div>
    );
}
