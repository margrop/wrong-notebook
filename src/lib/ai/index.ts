import "server-only";

import { AIService } from "./types";
import { GeminiProvider } from "./gemini-provider";
import { OpenAIProvider } from "./openai-provider";
import { AzureOpenAIProvider } from "./azure-provider";
import { AnthropicProvider } from "./anthropic-provider";
import { MiniMaxCodeProvider } from "./minimax-code-provider";
import { isVendorProvider, resolveVendorConfig, VENDOR_PRESETS } from "./vendor-presets";
import { limitModelConcurrency } from "./concurrency";

export * from "./types";

import { getAppConfig, getActiveOpenAIConfig } from "../config";
import { createLogger } from "../logger";

const logger = createLogger('ai');

/** 并发限制的分组键：同一渠道、地址和模型共用一组名额 */
function concurrencyKey(provider: string, baseUrl: string | undefined, model: string | undefined): string {
    return [provider, baseUrl || '', model || ''].join('|');
}

/** 当前配置的 AI 服务，所有调用受同一模型的并发上限约束 */
export function getAIService(): AIService {
    const { service, key } = createAIService();
    return limitModelConcurrency(service, key);
}

function createAIService(): { service: AIService; key: string } {
    // Always get fresh config
    const config = getAppConfig();
    const provider = config.aiProvider;

    if (provider === "openai") {
        const activeConfig = getActiveOpenAIConfig();
        logger.info({ activeInstance: activeConfig?.name }, 'Using OpenAI Provider');
        return { service: new OpenAIProvider(activeConfig), key: concurrencyKey(provider, activeConfig?.baseUrl, activeConfig?.model) };
    } else if (provider === "azure") {
        logger.info({ deployment: config.azure?.deploymentName }, 'Using Azure OpenAI Provider');
        return { service: new AzureOpenAIProvider(config.azure), key: concurrencyKey(provider, config.azure?.endpoint, config.azure?.deploymentName) };
    } else if (provider === "anthropic") {
        logger.info({ model: config.anthropic?.model }, 'Using Anthropic Provider');
        return { service: new AnthropicProvider(config.anthropic), key: concurrencyKey(provider, config.anthropic?.baseUrl, config.anthropic?.model) };
    } else if (provider === "minimax-code") {
        logger.info({ model: config.minimaxCode?.model }, 'Using MiniMax Code OAuth Provider');
        return { service: new MiniMaxCodeProvider(config.minimaxCode), key: concurrencyKey(provider, undefined, config.minimaxCode?.model) };
    } else if (provider === "gemini") {
        logger.info('Using Gemini Provider');
        return { service: new GeminiProvider(config.gemini), key: concurrencyKey(provider, config.gemini?.baseUrl, config.gemini?.model) };
    } else {
        // 国产大模型官方渠道；未知取值回退到默认的 MiniMax
        const vendor = isVendorProvider(provider) ? provider : 'minimax';
        const vendorConfig = resolveVendorConfig(vendor, config[vendor]);
        logger.info({ vendor: VENDOR_PRESETS[vendor].name, model: vendorConfig.model }, 'Using vendor provider (OpenAI compatible)');
        return { service: new OpenAIProvider(vendorConfig), key: concurrencyKey(vendor, vendorConfig.baseUrl, vendorConfig.model) };
    }
}
