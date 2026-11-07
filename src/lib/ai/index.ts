import "server-only";

import { AIService } from "./types";
import { GeminiProvider } from "./gemini-provider";
import { OpenAIProvider } from "./openai-provider";
import { AzureOpenAIProvider } from "./azure-provider";
import { AnthropicProvider } from "./anthropic-provider";
import { MiniMaxCodeProvider } from "./minimax-code-provider";
import { isVendorProvider, resolveVendorConfig, VENDOR_PRESETS } from "./vendor-presets";
import { limitModelConcurrency } from "./concurrency";
import { resolveProviderAssignment, routeRole } from "./routing";
import type { AiRouteRole } from "./routing";
import type { AiProviderId, AppConfig } from "../config/types";
import type { CompletionObserver } from "./completion";
import type { AiCallScope } from "./usage";
import type { AiAccountProvider, AiProviderOverride } from "./account";
import { getAiAccountProvider } from "./account-provider";

export * from "./types";
export type { AiCallKind, AiCallScope } from "./usage";
export type { AiRouteRole } from "./routing";

import { getAppConfig, getActiveOpenAIConfig } from "../config";
import { createLogger } from "../logger";

const logger = createLogger('ai');

/** 并发限制的分组键：同一渠道、地址和模型共用一组名额 */
function concurrencyKey(provider: string, baseUrl: string | undefined, model: string | undefined): string {
    return [provider, baseUrl || '', model || ''].join('|');
}

/** 能报告每次补全用量的 AI 服务 */
type ObservableAIService = AIService & { observeCompletions(observer: CompletionObserver | undefined): void };

/** 一个已创建好的渠道服务 */
interface ChannelService {
    service: ObservableAIService;
    key: string;
    provider: string;
}

/** 主渠道失败后可以改用备用渠道的错误：额度用完、凭据失效、无权限、模型不存在、图片不被支持 */
const FALLBACK_ERROR_CODES = ['AI_QUOTA_EXCEEDED', 'AI_AUTH_ERROR', 'AI_PERMISSION_DENIED', 'AI_NOT_FOUND', 'AI_IMAGE_NOT_SUPPORTED'];

/**
 * 为某个用户的某项操作取得 AI 服务：AI 账户实现可为该用户指定单独的 AI 配置（默认使用全站配置），
 * 每次补全的 token 用量交给 AI 账户实现记录；所有调用受同一模型的并发上限约束。
 * 未指定单独配置时按渠道分工选择识别/文本渠道，主渠道额度用完或凭据失效时改用备用渠道。
 */
export async function getAIService(scope: AiCallScope): Promise<AIService> {
    const account = getAiAccountProvider();
    const override = await account.resolveConfig(scope);
    if (override) {
        const { service, key, provider } = createOverrideService(override);
        observe(service, account, scope, provider);
        return limitModelConcurrency(service, key);
    }
    const config = getAppConfig();
    const vision = resolveProviderAssignment(config, 'vision');
    const text = resolveProviderAssignment(config, 'text');
    // 没有分工也没有备用渠道时直接用默认渠道，与旧行为一致（构造失败立即可见）
    if (vision.primary === text.primary && !vision.fallback && !text.fallback) {
        const created = createProviderService(vision.primary);
        observe(created.service, account, scope, created.provider);
        return limitModelConcurrency(created.service, created.key);
    }
    return createRoutedService(account, scope, config);
}

/**
 * 按渠道分工分派调用：每个方法按「图片识别 / 文本分析」选择渠道，
 * 主渠道返回额度不足、凭据失效等错误时改用备用渠道重试一次。
 * 渠道实例按需创建并缓存，同一模型仍受并发上限约束；用量记在实际使用的渠道名下。
 */
function createRoutedService(account: AiAccountProvider, scope: AiCallScope, config: AppConfig): AIService {
    const channels = new Map<AiProviderId, AIService>();

    /** 取得某渠道的服务；首次使用时创建、挂上用量记录并按并发上限包装 */
    function channel(providerId: AiProviderId): AIService {
        const cached = channels.get(providerId);
        if (cached) return cached;
        const created = createProviderService(providerId);
        observe(created.service, account, scope, created.provider);
        const limited = limitModelConcurrency(created.service, created.key);
        channels.set(providerId, limited);
        return limited;
    }

    async function dispatch(method: string, args: unknown[]): Promise<unknown> {
        const assignment = resolveProviderAssignment(config, methodRole(method, args));
        try {
            return await callMethod(channel(assignment.primary), method, args);
        } catch (error) {
            if (!assignment.fallback || !isFallbackError(error)) throw error;
            logger.warn(
                { error, userId: scope.userId, kind: scope.kind, method, from: assignment.primary, to: assignment.fallback },
                'AI channel failed, trying fallback channel',
            );
            return callMethod(channel(assignment.fallback), method, args);
        }
    }

    return new Proxy({} as AIService, {
        get(_target, prop) {
            if (typeof prop !== 'string' || prop === 'constructor' || prop === 'then') return undefined;
            return (...args: unknown[]) => dispatch(prop, args);
        },
    });
}

/** 每次补全结束后把用量交给 AI 账户实现；失败只记日志，不影响调用 */
function observe(service: ObservableAIService, account: AiAccountProvider, scope: AiCallScope, provider: string): void {
    service.observeCompletions((event) => account.record(scope, provider, event).catch((error: unknown) => {
        logger.error({ error, userId: scope.userId, kind: scope.kind }, 'AI account failed to record completion');
    }));
}

function callMethod(service: AIService, method: string, args: unknown[]): Promise<unknown> {
    const fn = (service as unknown as Record<string, unknown>)[method];
    if (typeof fn !== 'function') throw new Error(`AI_UNKNOWN_ERROR: unsupported method ${method}`);
    return (fn as (...params: unknown[]) => Promise<unknown>).apply(service, args);
}

/** 本次方法调用是否走图片输入：决定使用识别渠道还是文本渠道 */
function methodRole(method: string, args: unknown[]): AiRouteRole {
    if (method === 'analyzeImage' || method === 'generateFigureSvg') return 'vision';
    if (method === 'splitQuestions') {
        const input = args[0] as { kind?: string } | undefined;
        return input?.kind === 'image' ? 'vision' : 'text';
    }
    // reanswerQuestion 的第 4 个参数是图片
    if (method === 'reanswerQuestion') return args[3] ? 'vision' : 'text';
    return routeRole(method);
}

function isFallbackError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return FALLBACK_ERROR_CODES.some((code) => message.includes(code));
}

/** 用户单独指定的 OpenAI 兼容配置；并发分组不含 API Key，不同用户共用同一模型的名额 */
function createOverrideService(override: AiProviderOverride): ChannelService {
    const { provider, baseUrl, apiKey, model } = override;
    return {
        service: new OpenAIProvider({ apiKey, baseUrl, model }),
        key: concurrencyKey(provider, baseUrl, model),
        provider,
    };
}

function createProviderService(provider: AiProviderId): ChannelService {
    // Always get fresh config
    const config = getAppConfig();

    if (provider === "openai") {
        const activeConfig = getActiveOpenAIConfig();
        logger.info({ activeInstance: activeConfig?.name }, 'Using OpenAI Provider');
        return { service: new OpenAIProvider(activeConfig), key: concurrencyKey(provider, activeConfig?.baseUrl, activeConfig?.model), provider };
    } else if (provider === "azure") {
        logger.info({ deployment: config.azure?.deploymentName }, 'Using Azure OpenAI Provider');
        return { service: new AzureOpenAIProvider(config.azure), key: concurrencyKey(provider, config.azure?.endpoint, config.azure?.deploymentName), provider };
    } else if (provider === "anthropic") {
        logger.info({ model: config.anthropic?.model }, 'Using Anthropic Provider');
        return { service: new AnthropicProvider(config.anthropic), key: concurrencyKey(provider, config.anthropic?.baseUrl, config.anthropic?.model), provider };
    } else if (provider === "minimax-code") {
        logger.info({ model: config.minimaxCode?.model }, 'Using MiniMax Code OAuth Provider');
        return { service: new MiniMaxCodeProvider(config.minimaxCode), key: concurrencyKey(provider, undefined, config.minimaxCode?.model), provider };
    } else if (provider === "gemini") {
        logger.info('Using Gemini Provider');
        return { service: new GeminiProvider(config.gemini), key: concurrencyKey(provider, config.gemini?.baseUrl, config.gemini?.model), provider };
    } else {
        // 国产大模型官方渠道；未知取值回退到默认的 MiniMax
        const vendor = isVendorProvider(provider) ? provider : 'minimax';
        const vendorConfig = resolveVendorConfig(vendor, config[vendor]);
        logger.info({ vendor: VENDOR_PRESETS[vendor].name, model: vendorConfig.model }, 'Using vendor provider (OpenAI compatible)');
        return { service: new OpenAIProvider(vendorConfig), key: concurrencyKey(vendor, vendorConfig.baseUrl, vendorConfig.model), provider: vendor };
    }
}