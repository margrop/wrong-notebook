"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelSelector } from "@/components/ui/model-selector";
import { PasswordInput } from "@/components/ui/password-input";
import { FieldLabel } from "@/components/settings/field-label";
import { useLanguage } from "@/contexts/LanguageContext";
import { getProviderDocs } from "@/lib/ai/provider-docs";
import type { AppConfig } from "@/types/api";

type GeminiConfig = NonNullable<AppConfig["gemini"]>;

interface GeminiSettingsProps {
    value?: GeminiConfig;
    onChange: (value: GeminiConfig) => void;
}

/** Google Gemini 的配置表单 */
export function GeminiSettings({ value, onChange }: GeminiSettingsProps) {
    const { t } = useLanguage();
    const docs = getProviderDocs("gemini");
    const update = (key: keyof GeminiConfig, next: string) => onChange({ ...value, [key]: next });

    return (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
            <div className="space-y-2">
                <FieldLabel label="API Key" href={docs?.apiKey} linkText={t.settings.ai.docLinks.apiKey} />
                <PasswordInput
                    value={value?.apiKey || ''}
                    onChange={(e) => update('apiKey', e.target.value)}
                    placeholder="AIza..."
                />
            </div>
            <div className="space-y-2">
                <Label>Base URL (Optional)</Label>
                <Input
                    value={value?.baseUrl || ''}
                    onChange={(e) => update('baseUrl', e.target.value)}
                    placeholder="https://generativelanguage.googleapis.com"
                />
            </div>
            <ModelSelector
                provider="gemini"
                apiKey={value?.apiKey}
                baseUrl={value?.baseUrl}
                currentModel={value?.model}
                onModelChange={(model) => update('model', model)}
                docsHref={docs?.models}
            />
        </div>
    );
}
