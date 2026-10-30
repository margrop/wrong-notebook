/**
 * 各 AI 提供商的官方接入文档（API Key、接口地址、模型列表），设置页附上链接便于核对。
 * 同时有国内站和国际站的分别列出；MiniMax Code OAuth 使用网页登录，不需要。
 * 本文件不依赖 Node 模块，前端设置界面会引用。
 */
import { VENDOR_PRESETS, isVendorProvider } from "./vendor-presets";
import type { AppConfig } from "@/types/api";

export interface ProviderDocs {
    /** 国内站（中国大陆） */
    cn?: string;
    /** 国际站（海外）；只有一个入口的服务也放在这里 */
    intl?: string;
}

const OTHER_PROVIDER_DOCS: Partial<Record<AppConfig['aiProvider'], ProviderDocs>> = {
    openai: { intl: 'https://platform.openai.com/docs/api-reference' },
    anthropic: { intl: 'https://docs.anthropic.com/en/api/overview' },
    azure: { intl: 'https://learn.microsoft.com/azure/ai-foundry/openai/reference' },
    gemini: { intl: 'https://ai.google.dev/gemini-api/docs' },
};

/** 提供商的官方接入文档；没有（如 MiniMax Code OAuth）时返回 null */
export function getProviderDocs(provider: AppConfig['aiProvider']): ProviderDocs | null {
    if (isVendorProvider(provider)) return VENDOR_PRESETS[provider].docs;
    return OTHER_PROVIDER_DOCS[provider] ?? null;
}
