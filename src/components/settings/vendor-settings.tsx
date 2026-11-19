"use client";

import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { ModelSelector } from "@/components/ui/model-selector";
import { FieldLabel } from "@/components/settings/field-label";
import { useLanguage } from "@/contexts/LanguageContext";
import { VENDOR_PRESETS } from "@/lib/ai/vendor-presets";
import type { VendorConfig, VendorPreset, VendorProviderId } from "@/lib/ai/vendor-presets";

interface VendorSettingsProps {
    provider: VendorProviderId;
    value?: VendorConfig;
    onChange: (value: VendorConfig) => void;
}

/** 兼容渠道的配置表单，地址和模型留空时使用预设值 */
export function VendorSettings({ provider, value, onChange }: VendorSettingsProps) {
    const { t } = useLanguage();
    const preset: VendorPreset = VENDOR_PRESETS[provider];
    const update = (key: keyof VendorConfig, next: string) => onChange({ ...value, [key]: next });
    // 各渠道特有的地址说明
    const baseUrlHints: Partial<Record<VendorProviderId, string>> = {
        qwen: t.settings?.ai?.qwenBaseUrlHint,
        stepfun: t.settings?.ai?.stepfunBaseUrlHint,
        volcengine: t.settings?.ai?.volcengineBaseUrlHint,
        "volcengine-agent": t.settings?.ai?.volcengineAgentBaseUrlHint,
        "volcengine-coding": t.settings?.ai?.volcengineCodingBaseUrlHint,
        siliconflow: t.settings?.ai?.siliconflowBaseUrlHint,
        "siliconflow-global": t.settings?.ai?.siliconflowGlobalBaseUrlHint,
        "openai-responses": t.settings?.ai?.openaiResponsesBaseUrlHint,
    };
    // 免费额度说明：火山引擎新用户免费试用、硅基流动免费模型与体验赠金
    const freeNotices: Partial<Record<VendorProviderId, { title: string; body: string }>> = {
        "volcengine-free": t.settings?.ai?.volcengineFree,
        siliconflow: t.settings?.ai?.siliconflowFree,
        "siliconflow-global": t.settings?.ai?.siliconflowGlobalFree,
    };
    const notice = freeNotices[provider];

    return (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
            {notice && (
                <div className="rounded-md border border-green-200 bg-green-50 p-3 text-xs text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
                    <p className="font-medium">{notice.title}</p>
                    <p className="mt-1">{notice.body}</p>
                </div>
            )}
            <div className="space-y-2">
                <FieldLabel label="API Key" href={preset.docs.apiKey} linkText={t.settings.ai.docLinks.apiKey} />
                <PasswordInput
                    value={value?.apiKey || ""}
                    onChange={(e) => update("apiKey", e.target.value)}
                    placeholder={preset.defaultApiKey ?? "sk-..."}
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
                <p className="text-xs text-muted-foreground">{provider === "ollama" ? t.settings?.ai?.ollamaHint : baseUrlHints[provider] ?? t.settings?.ai?.vendorBaseUrlHint}</p>
            </div>
            <ModelSelector
                provider={provider}
                apiKey={value?.apiKey || preset.defaultApiKey}
                baseUrl={value?.baseUrl}
                currentModel={value?.model || preset.model}
                onModelChange={(model) => update("model", model)}
                docsHref={preset.docs.models}
            />
        </div>
    );
}
