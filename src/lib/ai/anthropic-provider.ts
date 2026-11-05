import Anthropic from "@anthropic-ai/sdk";
import type { AIConfig } from "./types";
import type { CompletionRequest } from './base-provider';
import type { CompletionResult, CompletionUsage } from './completion';
import { compactUsage, readRequestId } from './completion';
import { BaseAIProvider } from './base-provider';
import { createLogger } from '../logger';
import { trimTrailingSlashes } from '../utils';
import { withModelOutputLimit } from './truncation';
import { parseErrorCode } from './error-classification';

const logger = createLogger('ai:anthropic');

export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';

// 显式指定请求超时：SDK 在未指定超时且 max_tokens 较大时会拒绝非流式请求
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
type UserContent = string | Anthropic.ContentBlockParam[];

function toImageMediaType(mimeType: string | undefined): ImageMediaType {
    const normalized = (mimeType || '').toLowerCase();
    if (normalized === 'image/png' || normalized === 'image/gif' || normalized === 'image/webp') {
        return normalized;
    }
    return 'image/jpeg';
}

function imageBlock(base64: string, mimeType?: string): Anthropic.ImageBlockParam {
    // 兼容 data URL（data:image/png;base64,xxx）和纯 base64
    const match = base64.match(/^data:([^;]+);base64,([\s\S]*)$/);
    return {
        type: 'image',
        source: {
            type: 'base64',
            media_type: toImageMediaType(match ? match[1] : mimeType),
            data: match ? match[2] : base64,
        },
    };
}

/** 兼容接口沿用的 API 版本：SDK 1.x 默认发送 2026-10-21，第三方兼容接口未必支持 */
export const COMPAT_ANTHROPIC_VERSION = '2023-06-01';

function isOfficialAnthropicHost(baseURL: string): boolean {
    try {
        return new URL(baseURL).hostname === new URL(DEFAULT_ANTHROPIC_BASE_URL).hostname;
    } catch {
        return false;
    }
}

/**
 * 创建 SDK 客户端。apiKey 与 authToken 都显式传入（未用的传 null），避免 SDK 读取环境变量里的 ANTHROPIC_API_KEY。
 * - 官方接口：使用 SDK 默认的 API 版本和鉴权方式。
 * - 兼容接口（自定义地址、MiniMax Code 等）：保持与旧版 SDK 相同的请求头——API Key 以 x-api-key 发送、
 *   anthropic-version 为 2023-06-01。SDK 1.x 改为以 Authorization: Bearer 发送 API Key，不少兼容网关只认 x-api-key。
 * authToken（OAuth 登录的渠道）始终以 Authorization: Bearer 发送。
 */
export function createAnthropicClient(baseURL: string, apiKey?: string, authToken?: string): Anthropic {
    const options = { baseURL, timeout: REQUEST_TIMEOUT_MS };
    if (isOfficialAnthropicHost(baseURL)) {
        return apiKey
            ? new Anthropic({ ...options, apiKey, authToken: null })
            : new Anthropic({ ...options, apiKey: null, authToken });
    }
    const defaultHeaders: Record<string, string> = { 'anthropic-version': COMPAT_ANTHROPIC_VERSION };
    if (apiKey) {
        defaultHeaders['x-api-key'] = apiKey;
        return new Anthropic({ ...options, apiKey: null, authToken: null, defaultHeaders });
    }
    return new Anthropic({ ...options, apiKey: null, authToken, defaultHeaders });
}

/** 输入 token 含缓存写入和缓存命中部分；兼容接口可能缺少这些字段 */
function anthropicUsage(usage: Partial<Anthropic.Usage> | null | undefined): CompletionUsage | undefined {
    if (!usage) return undefined;
    const parts = [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens]
        .filter((value): value is number => typeof value === 'number');
    return compactUsage(parts.length > 0 ? parts.reduce((sum, value) => sum + value, 0) : undefined, usage.output_tokens);
}

/**
 * Anthropic Messages API 及其兼容接口（如各家模型的 /anthropic 端点）
 */
export class AnthropicProvider extends BaseAIProvider {
    protected readonly providerName = 'Anthropic';
    private client: Anthropic;
    private model: string;
    private baseURL: string;

    constructor(config?: AIConfig) {
        super();
        const apiKey = config?.apiKey;
        const authToken = config?.authToken;
        if (!apiKey && !authToken) {
            throw new Error("AI_AUTH_ERROR: ANTHROPIC_API_KEY is required for Anthropic provider");
        }

        // SDK 会自动拼接 /v1/messages，这里去掉用户可能多填的 /v1 和末尾斜杠
        this.baseURL = trimTrailingSlashes(config?.baseUrl || DEFAULT_ANTHROPIC_BASE_URL).replace(/\/v1$/, '');
        this.model = config?.model || DEFAULT_ANTHROPIC_MODEL;
        this.client = createAnthropicClient(this.baseURL, apiKey, authToken);

        logger.info({
            provider: 'Anthropic',
            model: this.model,
            baseURL: this.baseURL
        }, 'AI Provider initialized');
    }

    protected get configuredModel(): string {
        return this.model;
    }

    /** 发送一次单轮对话，返回正文、token 用量与请求 ID；按模型允许的最大输出请求 */
    protected async complete(request: CompletionRequest): Promise<CompletionResult> {
        let requestId: string | undefined;
        const response = await withModelOutputLimit(async (limit) => {
            let content: UserContent = request.user;
            if (request.image) {
                const blocks: Anthropic.ContentBlockParam[] = [
                    imageBlock(request.image.base64, request.image.mimeType),
                    { type: 'text', text: request.user },
                ];
                if (request.extraUserText) {
                    blocks.push({ type: 'text', text: request.extraUserText });
                }
                content = blocks;
            } else if (request.extraUserText) {
                content = `${request.user}\n${request.extraUserText}`;
            }
            const { data: message, response: httpResponse } = await this.client.messages.create({
                model: this.model,
                max_tokens: limit,
                system: request.system,
                messages: [{ role: 'user', content }],
            }).withResponse();
            requestId = readRequestId(httpResponse.headers);
            // 兼容接口的推理模型会返回 thinking 块，只取正文
            const text = message.content
                .filter((block): block is Anthropic.TextBlock => block.type === 'text')
                .map(block => block.text)
                .join('');
            logger.debug({ stopReason: message.stop_reason, usage: message.usage }, 'Anthropic response received');
            return {
                text,
                usage: anthropicUsage(message.usage),
                model: message.model,
                choices: [{ finish_reason: message.stop_reason === 'max_tokens' ? 'length' : message.stop_reason, message: { content: text } }],
            };
        }, this.model);

        if (!response.text) throw new Error("Empty response from AI");
        return { text: response.text, usage: response.usage, model: response.model || undefined, requestId };
    }

    protected handleError(error: unknown): void {
        logger.error({ error }, 'Anthropic error');
        if (error instanceof Error && (error.message === 'AI_OUTPUT_TRUNCATED' || error.message.startsWith('AI_RESPONSE_ERROR:'))) {
            throw error;
        }

        // SDK 的 APIError 带 HTTP 状态码，优先按状态码判断
        if (error instanceof Anthropic.APIConnectionTimeoutError) throw new Error("AI_TIMEOUT_ERROR", { cause: error });
        if (error instanceof Anthropic.APIConnectionError) throw new Error("AI_CONNECTION_FAILED", { cause: error });
        if (error instanceof Anthropic.APIError && error.status) {
            const status = error.status;
            if (status === 401) throw new Error("AI_AUTH_ERROR", { cause: error });
            if (status === 403) throw new Error("AI_PERMISSION_DENIED", { cause: error });
            if (status === 404) throw new Error("AI_NOT_FOUND", { cause: error });
            if (status === 408) throw new Error("AI_TIMEOUT_ERROR", { cause: error });
            if (status === 429) throw new Error("AI_QUOTA_EXCEEDED", { cause: error });
            if (status >= 500) throw new Error("AI_SERVICE_UNAVAILABLE", { cause: error }); // 含 529 overloaded
        }

        const code = parseErrorCode(error);
        throw new Error(code, { cause: error });
    }
}
