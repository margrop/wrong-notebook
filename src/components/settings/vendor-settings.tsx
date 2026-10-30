"use client";

import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { ModelSelector } from "@/components/ui/model-selector";
import { FieldLabel } from "@/components/settings/field-label";
import { useLanguage } from "@/contexts/LanguageContext";
import { VENDOR_PRESETS } from "@/lib/ai/vendor-presets";
import type { VendorConfig, VendorProviderId } from "@/lib/ai/vendor-presets";

interface VendorSettingsProps {
    provider: VendorProviderId;
    value?: VendorConfig;
    onChange: (value: VendorConfig) => void;
}

/** MiniMax、GLM 等国产大模型官方渠道的配置表单，地址和模型留空时使用官方默认值 */
export function VendorSettings({ provider, value, onChange }: VendorSettingsProps) {
    const { t } = useLanguage();
    const preset = VENDOR_PRESETS[provider];
    const update = (key: keyof VendorConfig, next: string) => onChange({ ...value, [key]: next });
    // 默认地址为套餐地址的渠道单独说明按量付费和国际站的地址
    const baseUrlHints: Partial<Record<VendorProviderId, string>> = {
        qwen: t.settings?.ai?.qwenBaseUrlHint,
        stepfun: t.settings?.ai?.stepfunBaseUrlHint,
        volcengine: t.settings?.ai?.volcengineBaseUrlHint,
        "volcengine-agent": t.settings?.ai?.volcengineAgentBaseUrlHint,
        "volcengine-coding": t.settings?.ai?.volcengineCodingBaseUrlHint,
    };

    return (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
            {provider === "volcengine-free" && (
                <div className="rounded-md border border-green-200 bg-green-50 p-3 text-xs text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
                    <p className="font-medium">{t.settings.ai.volcengineFree.title}</p>
                    <p className="mt-1">{t.settings.ai.volcengineFree.body}</p>
                </div>
            )}
            <div className="space-y-2">
                <FieldLabel label="API Key" href={preset.docs.apiKey} linkText={t.settings.ai.docLinks.apiKey} />
                <PasswordInput
                    value={value?.apiKey || ""}
                    onChange={(e) => update("apiKey", e.target.value)}
                    placeholder="sk-..."
                />
                <p className="text-xs text-muted-foreground">
                    {t.settings?.ai?.vendorApiKeyHint || "Get an API key from the console:"}{" "}
                    <a href={preset.consoleUrl} target="_blank" rel="noopener noreferrer" className="underline break-all">{preset.consoleUrl}</a>
                </p>
            </div>
            <div className="space-y-2">
                <Label>Base URL (Optional)</Label>
                <Input
                    value={value?.baseUrl || ""}
                    onChange={(e) => update("baseUrl", e.target.value)}
                    placeholder={preset.baseUrl}
                />
                <p className="text-xs text-muted-foreground">{baseUrlHints[provider] ?? t.settings?.ai?.vendorBaseUrlHint}</p>
            </div>
            <ModelSelector
                provider={provider}
                apiKey={value?.apiKey}
                baseUrl={value?.baseUrl}
                currentModel={value?.model || preset.model}
                onModelChange={(model) => update("model", model)}
                docsHref={preset.docs.models}
            />
        </div>
    );
}
