"use client";

import type { Dispatch, SetStateAction } from "react";
import { AnthropicSettings } from "@/components/settings/anthropic-settings";
import { AzureSettings } from "@/components/settings/azure-settings";
import { GeminiSettings } from "@/components/settings/gemini-settings";
import { MiniMaxCodeSettings } from "@/components/settings/minimax-code-settings";
import { OpenAIInstanceSettings } from "@/components/settings/openai-instance-settings";
import { VendorSettings } from "@/components/settings/vendor-settings";
import { isVendorProvider } from "@/lib/ai/vendor-presets";
import type { AiProviderId } from "@/lib/config/types";
import type { AppConfig } from "@/types/api";

interface ProviderConfigFormProps {
    provider: AiProviderId;
    config: AppConfig;
    setConfig: Dispatch<SetStateAction<AppConfig>>;
}

/** 渲染某个渠道自己的配置表单；切换渠道时整体替换该渠道的配置对象 */
export function ProviderConfigForm({ provider, config, setConfig }: ProviderConfigFormProps) {
    if (provider === 'openai') {
        return <OpenAIInstanceSettings value={config.openai} onChange={(openai) => setConfig(prev => ({ ...prev, openai }))} />;
    }
    if (provider === 'gemini') {
        return <GeminiSettings value={config.gemini} onChange={(gemini) => setConfig(prev => ({ ...prev, gemini }))} />;
    }
    if (provider === 'minimax-code') {
        return <MiniMaxCodeSettings value={config.minimaxCode} onChange={(minimaxCode) => setConfig(prev => ({ ...prev, minimaxCode }))} />;
    }
    if (provider === 'anthropic') {
        return <AnthropicSettings value={config.anthropic} onChange={(anthropic) => setConfig(prev => ({ ...prev, anthropic }))} />;
    }
    if (provider === 'azure') {
        return <AzureSettings value={config.azure} onChange={(azure) => setConfig(prev => ({ ...prev, azure }))} />;
    }
    if (isVendorProvider(provider)) {
        return (
            <VendorSettings
                key={provider}
                provider={provider}
                value={config[provider]}
                onChange={(vendorConfig) => setConfig(prev => ({ ...prev, [provider]: vendorConfig }))}
            />
        );
    }
    return null;
}