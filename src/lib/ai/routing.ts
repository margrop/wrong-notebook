/**
 * 渠道分工：把每次 AI 调用归到「图片识别」或「文本分析」两类，并为每类选出主渠道与备用渠道。
 * 本文件不依赖 Node 模块，设置界面也会引用。
 */
import type { AiProviderId, AppConfig } from '../config/types';
import { getVendorName, isVendorProvider, VENDOR_PROVIDER_IDS } from './vendor-presets';

/** 全部内置渠道列表，顺序与设置页的下拉一致 */
export const AI_PROVIDER_IDS = [
    ...VENDOR_PROVIDER_IDS,
    'minimax-code',
    'anthropic',
    'azure',
    'openai',
    'gemini',
] as const satisfies readonly AiProviderId[];

/** 走图片输入的调用：识别、配图重绘、图片分题、带图重新解题 */
const VISION_TASKS: Record<string, true> = { analyze: true, figure: true, reanswer: true, split: true };

export type AiRouteRole = 'vision' | 'text';

/** 本次调用属于图片识别还是文本分析；overrides 用于调用方已知是否随请求带图 */
export function routeRole(task: string, overrides?: { hasImage?: boolean }): AiRouteRole {
    const hasImage = overrides?.hasImage ?? VISION_TASKS[task] === true;
    return hasImage ? 'vision' : 'text';
}

/** 渠道的显示名称 */
export function aiProviderName(provider: AiProviderId, language: string): string {
    if (provider === 'minimax-code') return 'MiniMax Code OAuth';
    if (isVendorProvider(provider)) return getVendorName(provider, language);
    const names: Record<string, string> = {
        anthropic: 'Anthropic / Compatible',
        azure: 'Azure OpenAI',
        openai: 'OpenAI / Compatible',
        gemini: 'Google Gemini',
    };
    return names[provider] ?? provider;
}

/** 该渠道是否已配置到可使用的程度；MiniMax Code 使用服务端登录凭据 */
export function isProviderConfigured(config: AppConfig, provider: AiProviderId): boolean {
    if (provider === 'minimax-code') return true;
    if (provider === 'openai') {
        const active = config.openai?.instances?.find((instance) => instance.id === config.openai?.activeInstanceId);
        return Boolean(active?.apiKey?.trim());
    }
    if (provider === 'azure') {
        return Boolean(config.azure?.apiKey?.trim() && config.azure?.endpoint?.trim() && config.azure?.deploymentName?.trim());
    }
    const settings = config[provider as keyof AppConfig] as { apiKey?: string } | undefined;
    return Boolean(settings?.apiKey?.trim());
}

/** 一类调用的渠道分工：主渠道 + 备用渠道 */
export interface ProviderAssignment {
    primary: AiProviderId;
    fallback: AiProviderId | null;
}

/** 未知取值一律回退到默认渠道，避免配置损坏时完全没有 AI 可用 */
function normalizeProvider(value: string | undefined, defaultProvider: AiProviderId): AiProviderId {
    return value && AI_PROVIDER_IDS.includes(value as AiProviderId) ? value as AiProviderId : defaultProvider;
}

/**
 * 为一次调用选出主渠道与备用渠道。
 * 主渠道：该分工单独设置的渠道，未设置时跟随 aiProvider；
 * 备用渠道：全局备用渠道，与主渠道相同、未配置或留空时不启用。
 */
export function resolveProviderAssignment(config: AppConfig, role: AiRouteRole): ProviderAssignment {
    const defaultProvider = normalizeProvider(config.aiProvider, 'minimax');
    const primary = normalizeProvider(config.routing?.[role], defaultProvider);
    const fallbackCandidate = config.routing?.fallback ? normalizeProvider(config.routing.fallback, defaultProvider) : null;
    const fallback = fallbackCandidate && fallbackCandidate !== primary && isProviderConfigured(config, fallbackCandidate)
        ? fallbackCandidate
        : null;
    return { primary, fallback };
}