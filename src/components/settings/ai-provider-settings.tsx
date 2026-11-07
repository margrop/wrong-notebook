"use client";

import type { Dispatch, SetStateAction } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AiConnectionTest } from "@/components/settings/ai-connection-test";
import { ChannelRoutingSettings } from "@/components/settings/channel-routing-settings";
import { ProviderConfigForm } from "@/components/settings/provider-config-form";
import { ProviderDocLinks } from "@/components/settings/provider-doc-links";
import { useLanguage } from "@/contexts/LanguageContext";
import { AI_PROVIDER_IDS, aiProviderName, isProviderConfigured } from "@/lib/ai/routing";
import type { AiProviderId } from "@/lib/config/types";
import type { AppConfig } from "@/types/api";

interface AiProviderSettingsProps {
    config: AppConfig;
    setConfig: Dispatch<SetStateAction<AppConfig>>;
    loading: boolean;
    saving: boolean;
    onSave: () => void;
}

/** AI 渠道设置：选择渠道、填写对应配置、按识别/文本分工渠道、测试连接并保存 */
export function AiProviderSettings({ config, setConfig, loading, saving, onSave }: AiProviderSettingsProps) {
    const { t, language } = useLanguage();

    if (loading) {
        return (
            <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const configured = AI_PROVIDER_IDS.filter((id) => isProviderConfigured(config, id));

    return (
        <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
            <div className="space-y-2">
                <Label>{t.settings?.tabs?.ai || "AI Provider"}</Label>
                <Select
                    value={config.aiProvider}
                    onValueChange={(val: AiProviderId) => setConfig(prev => ({ ...prev, aiProvider: val }))}
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {AI_PROVIDER_IDS.map((id) => (
                            <SelectItem key={id} value={id}>{aiProviderName(id, language)}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <ProviderDocLinks provider={config.aiProvider} />
                {configured.length > 1 && (
                    <p className="text-xs text-muted-foreground">
                        {(t.settings?.ai?.configuredChannels || "Already configured: {names}. Keep several channels so one can back up another.").replace(
                            "{names}",
                            configured.map((id) => aiProviderName(id, language)).join(t.settings?.ai?.routing?.listSeparator || ", "),
                        )}
                    </p>
                )}
            </div>

            <ProviderConfigForm provider={config.aiProvider} config={config} setConfig={setConfig} />

            <ChannelRoutingSettings config={config} setConfig={setConfig} />

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