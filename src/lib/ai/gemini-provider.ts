import { GoogleGenAI } from "@google/genai";
import type { AIConfig } from "./types";
import type { CompletionRequest } from './base-provider';
import type { CompletionResult } from './completion';
import { compactUsage, readRequestId } from './completion';
import { BaseAIProvider } from './base-provider';
import { createLogger } from '../logger';
import { AI_OUTPUT_TRUNCATED } from './truncation';

const logger = createLogger('ai:gemini');

type GeminiContent = string | Array<
    { text: string } |
    { inlineData: { mimeType: string; data: string } }
>;

/**
 * Google Gemini 提供商：继承 BaseAIProvider，只保留 SDK 构造、complete 实现
 * （图片 inlineData 格式、MAX_TOKENS 截断判定、指数退避重试）与自身错误归类。
 */
export class GeminiProvider extends BaseAIProvider {
    protected readonly providerName = 'Gemini';
    private ai: GoogleGenAI;
    private modelName: string;
    private baseUrl: string;

    constructor(config?: AIConfig) {
        super();
        const apiKey = config?.apiKey;
        const baseUrl = config?.baseUrl;

        if (!apiKey) {
            throw new Error("AI_AUTH_ERROR: GOOGLE_API_KEY is required for Gemini provider");
        }

        // 使用 httpOptions.baseUrl 来配置自定义 API 地址，避免全局 setDefaultBaseUrls 的竞态条件
        // 参考：@google/genai 的 GoogleGenAIOptions.httpOptions.baseUrl
        this.ai = new GoogleGenAI({
            apiKey,
            httpOptions: baseUrl ? {
                baseUrl: baseUrl
            } : undefined
        });

        this.modelName = config?.model || 'gemini-2.0-flash';
        this.baseUrl = baseUrl || 'https://generativelanguage.googleapis.com';

        logger.info({
            provider: 'Gemini',
            model: this.modelName,
            baseUrl: this.baseUrl
        }, 'AI Provider initialized');
    }

    protected get configuredModel(): string {
        return this.modelName;
    }

    /** 发送一次单轮请求，返回正文、token 用量与请求 ID；对可重试错误做指数退避重试（1s/2s/4s，最多 3 次） */
    protected async complete(request: CompletionRequest): Promise<CompletionResult> {
        const contents = this.buildContents(request);
        const response = await this.retryOperation(() => this.ai.models.generateContent({
            model: this.modelName,
            config: { systemInstruction: request.system },
            contents,
        }));

        const text = response.text || '';
        if (!text) {
            throw new Error(response.candidates?.[0]?.finishReason === 'MAX_TOKENS' ? AI_OUTPUT_TRUNCATED : "Empty response from AI");
        }
        // 输出 token 计入思考部分，与其他服务商的计费口径一致
        const usage = response.usageMetadata;
        const outputParts = [usage?.candidatesTokenCount, usage?.thoughtsTokenCount].filter((value): value is number => typeof value === 'number');
        return {
            text,
            usage: compactUsage(usage?.promptTokenCount, outputParts.length > 0 ? outputParts.reduce((sum, value) => sum + value, 0) : undefined),
            model: response.modelVersion || undefined,
            requestId: readRequestId(response.sdkHttpResponse?.headers) || response.responseId || undefined,
        };
    }

    /** 按请求构建 Gemini contents：文字在前，图片以 inlineData 附加在后 */
    private buildContents(request: CompletionRequest): GeminiContent {
        if (!request.image) {
            return request.user;
        }
        // 兼容 data URL（data:image/xxx;base64,...）前缀：去掉前缀，声明类型沿用传入的 mimeType（缺省 image/jpeg）
        const base64Data = request.image.base64.replace(/^data:image\/\w+;base64,/, '');
        const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
            { text: request.user },
            {
                inlineData: {
                    data: base64Data,
                    mimeType: request.image.mimeType || 'image/jpeg',
                },
            },
        ];
        // 原 Gemini 的 generateFigureSvg 不在图片后附加额外文字（extraUserText 是 Anthropic 的行为），这里按 task 忽略
        if (request.extraUserText && request.task !== 'figure') {
            contents.push({ text: request.extraUserText });
        }
        return contents;
    }

    private async retryOperation<T>(operation: () => Promise<T>, maxRetries: number = 3): Promise<T> {
        let lastError: unknown;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                const msg = error instanceof Error ? error.message.toLowerCase() : String(error);

                // Identify retryable errors
                const isRetryable =
                    msg.includes('fetch failed') ||
                    msg.includes('network') ||
                    msg.includes('connect') ||
                    msg.includes('503') ||
                    msg.includes('502') ||  // Bad Gateway
                    msg.includes('504') ||  // Gateway Timeout
                    msg.includes('overloaded') ||
                    msg.includes('timeout') ||
                    msg.includes('etimedout') ||  // Connection timeout
                    msg.includes('enotfound') ||  // DNS resolution failed
                    msg.includes('econnreset') ||
                    msg.includes('econnrefused') ||  // Connection refused
                    msg.includes('unavailable');

                if (!isRetryable || attempt === maxRetries) {
                    throw error;
                }

                const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff: 1s, 2s, 4s
                logger.warn({ attempt, maxRetries, error: msg, nextRetryDelayMs: delay }, 'Gemini operation failed, retrying...');
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw lastError;
    }

    protected handleError(error: unknown): void {
        // AI_OUTPUT_TRUNCATED 由 complete 抛出，需原样透传（基类默认实现不透传）
        if (error instanceof Error && error.message === AI_OUTPUT_TRUNCATED) {
            throw error;
        }
        super.handleError(error);
    }
}
