/**
 * AI 数据授权：前端在任意位置请求弹出授权窗口，由 AiConsentDialog 订阅并显示。
 * 本文件不依赖 Node 模块，可在客户端组件与 apiClient 中使用。
 */

import { VENDOR_PRESETS } from "@/lib/ai/vendor-presets";
import type { VendorProviderId } from "@/lib/ai/vendor-presets";

/** prompt：登录后主动询问；blocked：AI 请求因未授权被拒绝后询问 */
export type AiConsentReason = "prompt" | "blocked";

type Listener = (reason: AiConsentReason) => void;

const listeners = new Set<Listener>();

/** 订阅授权请求，返回取消订阅函数 */
export function subscribeAiConsentRequest(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** 请求弹出授权窗口；未挂载 AiConsentDialog 时（如单元测试）静默忽略 */
export function requestAiConsent(reason: AiConsentReason): void {
    listeners.forEach((listener) => listener(reason));
}

/** 服务端返回的错误体是否表示「尚未同意 AI 数据授权」 */
export function isAiConsentRequired(data: unknown): boolean {
    return typeof data === "object" && data !== null && "code" in data && data.code === "AI_CONSENT_REQUIRED";
}

/** 官网隐私政策地址 */
export function privacyPolicyUrl(language: "zh" | "en"): string {
    return language === "en" ? "https://wrong-notebook.margrop.net/en/privacy/" : "https://wrong-notebook.margrop.net/privacy/";
}

const PROVIDER_NAMES: Record<string, { zh: string; en: string }> = {
    gemini: { zh: "Google Gemini", en: "Google Gemini" },
    openai: { zh: "OpenAI 或管理员填写的兼容接口", en: "OpenAI or an OpenAI-compatible endpoint set by the administrator" },
    azure: { zh: "Microsoft Azure OpenAI", en: "Microsoft Azure OpenAI" },
    anthropic: { zh: "Anthropic Claude", en: "Anthropic Claude" },
    "minimax-code": { zh: "MiniMax", en: "MiniMax" },
};

/** 设置中的 AI 渠道 ID 对应的服务商名称；未知时返回 null */
export function aiProviderDisplayName(provider: string | null | undefined, language: "zh" | "en"): string | null {
    if (!provider) return null;
    const known = PROVIDER_NAMES[provider];
    if (known) return known[language];
    if (!(provider in VENDOR_PRESETS)) return null;
    const preset = VENDOR_PRESETS[provider as VendorProviderId];
    return language === "en" ? preset.nameEn : preset.name;
}
