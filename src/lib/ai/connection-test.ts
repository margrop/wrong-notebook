import { isVendorProvider } from "@/lib/ai/vendor-presets";
import type { AppConfig } from "@/types/api";
import type { VendorProviderId } from "@/lib/ai/vendor-presets";

/** /api/ai/test 的请求体 */
export interface AITestRequest {
    provider: 'openai' | 'gemini' | 'azure' | 'anthropic' | 'minimax-code' | VendorProviderId;
    /** MiniMax Code 使用已登录的凭据，不需要 apiKey */
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    // Azure 特有
    endpoint?: string;
    deploymentName?: string;
    apiVersion?: string;
    // 语言
    language?: 'zh' | 'en';
}

/** /api/ai/test 的响应体 */
export interface AITestResponse {
    success: boolean;
    textSupport: boolean;
    visionSupport: boolean;
    textError?: string;
    visionError?: string;
    /** 服务商的原始报错，便于管理员排查 */
    textErrorDetail?: string;
    visionErrorDetail?: string;
    modelInfo?: string;
}

/** 设置页「测试连接」发给 /api/ai/test 的请求体；缺少必填项时返回错误码 */
export type ConnectionTestRequest =
    | { ok: true; body: Record<string, unknown> }
    | { ok: false; error: 'API_KEY_REQUIRED' | 'AZURE_CONFIG_INCOMPLETE' | 'UNSUPPORTED_PROVIDER' };

export function buildConnectionTestRequest(config: AppConfig, language: string): ConnectionTestRequest {
    const provider = config.aiProvider;

    if (provider === 'openai') {
        const instance = config.openai?.instances?.find((item) => item.id === config.openai?.activeInstanceId);
        if (!instance?.apiKey) return { ok: false, error: 'API_KEY_REQUIRED' };
        return { ok: true, body: { provider, apiKey: instance.apiKey, baseUrl: instance.baseUrl, model: instance.model, language } };
    }

    if (provider === 'azure') {
        const azure = config.azure;
        if (!azure?.apiKey || !azure.endpoint || !azure.deploymentName) return { ok: false, error: 'AZURE_CONFIG_INCOMPLETE' };
        return {
            ok: true,
            body: { provider, apiKey: azure.apiKey, endpoint: azure.endpoint, deploymentName: azure.deploymentName, apiVersion: azure.apiVersion, model: azure.model, language },
        };
    }

    // MiniMax Code 使用服务端保存的登录凭据，只需要模型
    if (provider === 'minimax-code') {
        return { ok: true, body: { provider, model: config.minimaxCode?.model, language } };
    }

    // Gemini、Anthropic 与国产大模型渠道的配置结构相同：apiKey、baseUrl、model
    if (provider === 'gemini' || provider === 'anthropic' || isVendorProvider(provider)) {
        const settings = config[provider];
        if (!settings?.apiKey) return { ok: false, error: 'API_KEY_REQUIRED' };
        return { ok: true, body: { provider, apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.model, language } };
    }

    return { ok: false, error: 'UNSUPPORTED_PROVIDER' };
}
