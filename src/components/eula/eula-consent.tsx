"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { EulaSummary } from "@/components/eula/eula-summary";
import { useLanguage } from "@/contexts/LanguageContext";

interface EulaConsentProps {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
}

/** 协议摘要 + 必选复选框，用于初始化页与开启外发前的确认对话框 */
export function EulaConsent({ checked, onCheckedChange, disabled }: EulaConsentProps) {
    const { t } = useLanguage();
    return (
        <div className="space-y-3 rounded-lg border p-3">
            <p className="text-sm font-medium">{t.eula.title}</p>
            <EulaSummary />
            <label className="flex items-start gap-2 text-sm">
                <Checkbox
                    id="eula-consent"
                    className="mt-0.5"
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(value) => onCheckedChange(value === true)}
                />
                <span>{t.eula.consentLabel}</span>
            </label>
        </div>
    );
}
