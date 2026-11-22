"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { useMobileNav } from "@/contexts/MobileNavContext";
import { getErrorMessage } from "@/lib/error-message";
import { frontendLogger } from "@/lib/frontend-logger";
import type { MobileNavFourth } from "@/lib/mobile-nav";

/** 选择手机底部导航栏的第 4 个入口，保存到当前账号。 */
export function MobileNavPreferenceSetting() {
    const { t } = useLanguage();
    const { fourth, loaded, setFourth } = useMobileNav();
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const handleChange = async (value: string) => {
        if (value !== "exams" && value !== "review") return;
        const next = value as MobileNavFourth;
        setSaving(true);
        setMessage(null);
        try {
            await setFourth(next);
            setMessage(t.importFlow.preferenceSaved);
        } catch (error: unknown) {
            setMessage(t.importFlow.preferenceSaveFailed);
            frontendLogger.error("[Settings]", "Failed to save mobile navigation preference", { error: getErrorMessage(error) });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-2 border-t pt-4">
            <Label htmlFor="mobile-nav-fourth">{t.settings?.general?.mobileNavFourthLabel || "Mobile bottom navigation 4th button"}</Label>
            <Select value={fourth} onValueChange={handleChange} disabled={!loaded || saving}>
                <SelectTrigger id="mobile-nav-fourth">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="exams">{t.settings?.general?.mobileNavFourthOptions?.exams || "试卷"}</SelectItem>
                    <SelectItem value="review">{t.settings?.general?.mobileNavFourthOptions?.review || "复习"}</SelectItem>
                </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
                {t.settings?.general?.mobileNavFourthDesc || "选择手机底部导航栏的第 4 个入口，默认为试卷。"}
            </p>
            {message && <p className="text-xs text-muted-foreground" role="status">{message}</p>}
        </div>
    );
}
