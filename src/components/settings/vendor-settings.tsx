"use client";

import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { ModelSelector } from "@/components/ui/model-selector";
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

    return (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
            <div className="space-y-2">
                <Label>API Key</Label>
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
                <p className="text-xs text-muted-foreground">{provider === "qwen" ? t.settings?.ai?.qwenBaseUrlHint : t.settings?.ai?.vendorBaseUrlHint}</p>
            </div>
            <ModelSelector
                provider={provider}
                apiKey={value?.apiKey}
                baseUrl={value?.baseUrl}
                currentModel={value?.model || preset.model}
                onModelChange={(model) => update("model", model)}
            />
        </div>
    );
}
