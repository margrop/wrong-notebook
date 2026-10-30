"use client";

import type { Dispatch, SetStateAction } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AiConnectionTest } from "@/components/settings/ai-connection-test";
import { AnthropicSettings } from "@/components/settings/anthropic-settings";
import { AzureSettings } from "@/components/settings/azure-settings";
import { GeminiSettings } from "@/components/settings/gemini-settings";
import { MiniMaxCodeSettings } from "@/components/settings/minimax-code-settings";
import { OpenAIInstanceSettings } from "@/components/settings/openai-instance-settings";
import { ProviderDocLinks } from "@/components/settings/provider-doc-links";
import { VendorSettings } from "@/components/settings/vendor-settings";
import { useLanguage } from "@/contexts/LanguageContext";
import { isVendorProvider, VENDOR_PRESETS, VENDOR_PROVIDER_IDS } from "@/lib/ai/vendor-presets";
import type { AppConfig } from "@/types/api";

interface AiProviderSettingsProps {
    config: AppConfig;
    setConfig: Dispatch<SetStateAction<AppConfig>>;
    loading: boolean;
    saving: boolean;
    onSave: () => void;
}

/** AI 渠道设置：选择渠道、填写对应配置、测试连接并保存 */
export function AiProviderSettings({ config, setConfig, loading, saving, onSave }: AiProviderSettingsProps) {
    const { t } = useLanguage();

    if (loading) {
        return (
            <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
            <div className="space-y-2">
                <Label>{t.settings?.tabs?.ai || "AI Provider"}</Label>
                <Select
                    value={config.aiProvider}
                    onValueChange={(val: AppConfig['aiProvider']) => setConfig(prev => ({ ...prev, aiProvider: val }))}
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {/* MiniMax Code OAuth 排在第 2 位，紧跟 MiniMax 官方渠道 */}
                        <SelectItem value="minimax">{VENDOR_PRESETS.minimax.name}</SelectItem>
                        <SelectItem value="minimax-code">MiniMax Code OAuth</SelectItem>
                        {VENDOR_PROVIDER_IDS.filter((id) => id !== 'minimax').map((id) => (
                            <SelectItem key={id} value={id}>{VENDOR_PRESETS[id].name}</SelectItem>
                        ))}
                        <SelectItem value="anthropic">Anthropic / Compatible</SelectItem>
                        <SelectItem value="azure">Azure OpenAI</SelectItem>
                        <SelectItem value="openai">OpenAI / Compatible</SelectItem>
                        <SelectItem value="gemini">Google Gemini</SelectItem>
                    </SelectContent>
                </Select>
                <ProviderDocLinks provider={config.aiProvider} />
            </div>

            {config.aiProvider === 'openai' && (
                <OpenAIInstanceSettings value={config.openai} onChange={(openai) => setConfig(prev => ({ ...prev, openai }))} />
            )}

            {config.aiProvider === 'gemini' && (
                <GeminiSettings value={config.gemini} onChange={(gemini) => setConfig(prev => ({ ...prev, gemini }))} />
            )}

            {config.aiProvider === 'minimax-code' && (
                <MiniMaxCodeSettings value={config.minimaxCode} onChange={(minimaxCode) => setConfig(prev => ({ ...prev, minimaxCode }))} />
            )}

            {config.aiProvider === 'anthropic' && (
                <AnthropicSettings value={config.anthropic} onChange={(anthropic) => setConfig(prev => ({ ...prev, anthropic }))} />
            )}

            {isVendorProvider(config.aiProvider) && (
                <VendorSettings
                    key={config.aiProvider}
                    provider={config.aiProvider}
                    value={config[config.aiProvider]}
                    onChange={(vendorConfig) => setConfig(prev => ({ ...prev, [prev.aiProvider]: vendorConfig }))}
                />
            )}

            {config.aiProvider === 'azure' && (
                <AzureSettings value={config.azure} onChange={(azure) => setConfig(prev => ({ ...prev, azure }))} />
            )}

            <AiConnectionTest
                config={config}
                saving={saving}
                saveButton={
                    <Button onClick={onSave} disabled={saving} className="flex-1">
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {t.settings?.ai?.save || "Save AI Settings"}
                    </Button>
                }
            />
        </div>
    );
}
