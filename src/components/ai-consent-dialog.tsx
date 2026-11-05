"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { aiProviderDisplayName, privacyPolicyUrl, subscribeAiConsentRequest } from "@/lib/ai-consent";
import type { AiConsentReason } from "@/lib/ai-consent";
import { apiClient } from "@/lib/api-client";
import { isBarePath } from "@/lib/app-navigation";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";

const DISMISS_KEY_PREFIX = "ai-consent-dismissed:";

function readDismissed(key: string): boolean {
    try {
        return sessionStorage.getItem(key) === "1";
    } catch {
        return false;
    }
}

function writeDismissed(key: string) {
    try {
        sessionStorage.setItem(key, "1");
    } catch {
        // 无法写入时下次打开页面会再询问一次
    }
}

/**
 * AI 数据授权窗口：
 * - 登录后尚未授权时主动询问一次，「暂不同意」后本次浏览不再主动弹出；
 * - AI 请求因未授权被拒绝时（apiClient 触发）再次弹出。
 * 登录、注册、安装向导和打印等无外框页面不主动弹出。
 */
export function AiConsentDialog() {
    const { t, language } = useLanguage();
    const text = t.aiConsent;
    const { data: session, status } = useSession();
    const pathname = usePathname() || "/";
    const email = status === "authenticated" ? session?.user?.email ?? null : null;
    const [reason, setReason] = useState<AiConsentReason | null>(null);
    const [provider, setProvider] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => subscribeAiConsentRequest((next) => setReason((current) => current ?? next)), []);

    const bare = isBarePath(pathname);
    useEffect(() => {
        if (!email || bare || readDismissed(DISMISS_KEY_PREFIX + email)) return;
        let cancelled = false;
        apiClient.get<{ aiDataConsentAt?: string | null }>("/api/user")
            .then((profile) => {
                if (!cancelled && profile && !profile.aiDataConsentAt) setReason((current) => current ?? "prompt");
            })
            .catch((error) => frontendLogger.error("[AiConsentDialog]", "load consent failed", { error }));
        return () => {
            cancelled = true;
        };
    }, [email, bare]);

    const open = reason !== null && !!email;
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        apiClient.get<{ aiProvider?: string }>("/api/settings")
            .then((settings) => {
                if (!cancelled) setProvider(settings?.aiProvider ?? null);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [open]);

    const close = () => {
        setReason(null);
        setSaving(false);
    };

    const handleAgree = async () => {
        setSaving(true);
        try {
            await apiClient.post("/api/user/ai-consent", {});
            toast.success(reason === "blocked" ? text.agreedRetry : text.agreed);
            close();
        } catch (error) {
            frontendLogger.error("[AiConsentDialog]", "save consent failed", { error });
            toast.error(text.failed);
            setSaving(false);
        }
    };

    const handleDecline = () => {
        if (email) writeDismissed(DISMISS_KEY_PREFIX + email);
        toast.info(text.declined);
        close();
    };

    const providerName = aiProviderDisplayName(provider, language);

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) handleDecline(); }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{text.title}</DialogTitle>
                    <DialogDescription>{reason === "blocked" ? text.blocked : text.intro}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                    {reason === "blocked" && <p>{text.intro}</p>}
                    <ul className="list-disc space-y-1 pl-5">
                        {text.items.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                    <p>{providerName ? text.providerKnown.replace("{provider}", providerName) : text.providerUnknown}</p>
                    <p>
                        {text.policy}{language === "en" ? " " : ""}
                        <a className="underline underline-offset-2" href={privacyPolicyUrl(language)} target="_blank" rel="noopener noreferrer">{text.policyLink}</a>
                        {language === "en" ? "." : "。"}
                    </p>
                    <p className="text-muted-foreground">{text.declineNote}</p>
                </div>
                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={handleDecline} disabled={saving}>{text.decline}</Button>
                    <Button type="button" onClick={handleAgree} disabled={saving}>
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                        {text.agree}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
