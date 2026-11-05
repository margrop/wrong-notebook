import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { AIService, AIConfig } from "./types";
import type { CompletionRequest } from './base-provider';
import type { CompletionResult } from './completion';
import { compactUsage, readRequestId } from './completion';
import { BaseAIProvider } from './base-provider';
import { createLogger } from '../logger';
import { AI_OUTPUT_TRUNCATED, withModelOutputLimit } from './truncation';
import type { FigureResult } from './schema';
import { parseFigure } from './schema';
import { extractTag } from './response-parser';

const logger = createLogger('ai:openai');

export const DEFAULT_OPENAI_MODEL = 'gpt-6.1-sol';

/** 发给 LongCat 的消息内容片段：OpenAI 格式的文字、图片，以及 LongCat 的 input_image */
type LongCatContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
    | { type: 'input_image'; input_image: { data: string[]; type: 'url' } };

interface LongCatMessage {
    role: string;
    content: string | LongCatContentPart[];
}

type OpenAIUserContent = string | Array<
    { type: "text"; text: string } |
    { type: "image_url"; image_url: { url: string } }
>;

export class OpenAIProvider extends BaseAIProvider implements AIService {
    protected readonly providerName: string = 'OpenAI';
    protected openai: OpenAI;
    protected model: string;
    protected baseURL: string;
    protected apiKey: string;
    private isLongCat: boolean;

    constructor(config?: AIConfig) {
        super();
        const apiKey = config?.apiKey;
        const baseURL = config?.baseUrl;

        if (!apiKey) {
            throw new Error("AI_AUTH_ERROR: OPENAI_API_KEY is required for OpenAI provider");
        }

        this.model = config?.model || DEFAULT_OPENAI_MODEL;
        this.baseURL = baseURL || 'https://api.openai.com/v1';
        this.apiKey = apiKey;
        this.isLongCat = this.baseURL.includes('longcat.chat');
        this.openai = this.createClient(config);

        logger.info({
            provider: 'OpenAI',
            model: this.model,
            baseURL: this.baseURL
        }, 'AI Provider initialized');
    }

    /** 创建 SDK 客户端；Azure 等子类可覆盖以使用其他 OpenAI 兼容客户端 */
    protected createClient(config: AIConfig): OpenAI {
        return new OpenAI({
            apiKey: this.apiKey,
            baseURL: config?.baseUrl || undefined,
            defaultHeaders: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });
    }

    /** 请求体中的 model 字段（Azure 使用 deployment 名称） */
    protected get requestModel(): string {
        return this.model;
    }

    protected get configuredModel(): string {
        return this.model;
    }

    /** withModelOutputLimit 使用的模型名（Azure 使用显示名而非 deployment） */
    protected get outputLimitModel(): string {
        return this.model;
    }

    private adaptMessagesForLongCat(messages: LongCatMessage[]): LongCatMessage[] {
        return messages.map(msg => {
            if (typeof msg.content === 'string') {
                return { ...msg, content: [{ type: 'text', text: msg.content }] };
            }
            if (Array.isArray(msg.content)) {
                const adapted = msg.content.map((part): LongCatContentPart => {
                    if (part.type === 'image_url') {
                        return {
                            type: 'input_image',
                            input_image: { data: [part.image_url.url], type: 'url' }
                        };
                    }
                    return part;
                });
                return { ...msg, content: adapted };
            }
            return msg;
        });
    }

    /**
     * 发送一次单轮对话，返回正文、token 用量与请求 ID。
     * 有图片且为 LongCat 时绕过 SDK 直接 fetch（LongCat 用 input_image 格式）；
     * 配图重绘（figure）时图片放在文字前，其余任务图片放在文字后。
     */
    protected async complete(request: CompletionRequest): Promise<CompletionResult> {
        const systemMessage = { role: "system", content: request.system };
        let userContent: OpenAIUserContent = request.user;

        if (request.image) {
            const imageUrl = request.image.base64.startsWith('data:')
                ? request.image.base64
                : `data:${request.image.mimeType || 'image/jpeg'};base64,${request.image.base64}`;

            if (request.task === 'figure') {
                // 配图重绘：图片在文字前
                const parts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
                    { type: "image_url", image_url: { url: imageUrl } },
                    { type: "text", text: request.user },
                ];
                userContent = parts;
            } else {
                const parts: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
                    { type: "text", text: request.user },
                    { type: "image_url", image_url: { url: imageUrl } },
                ];
                userContent = parts;
            }
        }

        // LongCat 的多模态格式与 OpenAI 不同，analyze 和 question-split 任务绕过 SDK 直接请求
        const useLongCatFetch = request.image && this.isLongCat &&
            (request.task === 'analyze' || request.task === 'question-split');

        if (useLongCatFetch) {
            const messages: LongCatMessage[] = [systemMessage, { role: "user", content: userContent }];
            const adaptedMessages = this.adaptMessagesForLongCat(messages);
            let longCatRequestId: string | undefined;
            const response = await withModelOutputLimit(async (maxTokens) => {
                const res = await fetch(`${this.baseURL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: this.model,
                        messages: adaptedMessages,
                        max_tokens: maxTokens,
                    }),
                });

                if (!res.ok) {
                    const errBody = await res.text();
                    logger.error({ status: res.status, body: errBody }, 'LongCat API error');
                    throw new Error(`${res.status} status code (${errBody})`);
                }

                longCatRequestId = readRequestId(res.headers);
                return await res.json() as ChatCompletion;
            }, this.outputLimitModel);

            const text = response.choices?.[0]?.message?.content || '';
            if (!text) throw new Error("Empty response from AI");
            return this.toCompletionResult(text, response, longCatRequestId);
        }

        let requestId: string | undefined;
        const response = await withModelOutputLimit(async (maxTokens) => {
            const { data, response: httpResponse } = await this.openai.chat.completions.create({
                model: this.requestModel,
                messages: [
                    { role: "system", content: request.system },
                    { role: "user", content: userContent },
                ],
                max_tokens: maxTokens,
            }).withResponse();
            requestId = readRequestId(httpResponse.headers);
            return data;
        }, this.outputLimitModel);

        // analyze/similar/reanswer 对空 choices 抛 AI_RESPONSE_ERROR，其余任务按空响应处理（AI_UNKNOWN_ERROR）
        if (request.task === 'analyze' || request.task === 'similar' || request.task === 'reanswer') {
            if (!response || !response.choices || response.choices.length === 0) {
                logger.error({ response: JSON.stringify(response) }, 'Invalid API response - no choices array');
                throw new Error("AI_RESPONSE_ERROR: API returned empty or invalid response");
            }
        }

        const text = response.choices?.[0]?.message?.content || "";
        if (!text) throw new Error("Empty response from AI");
        return this.toCompletionResult(text, response, requestId);
    }

    /** 从 Chat Completions 响应取 token 用量和实际模型 */
    private toCompletionResult(text: string, response: ChatCompletion, requestId: string | undefined): CompletionResult {
        return {
            text,
            usage: compactUsage(response.usage?.prompt_tokens, response.usage?.completion_tokens),
            model: response.model || undefined,
            requestId,
        };
    }

    /**
     * 单独重绘配图：与基类不同，不附加额外文字，且图片放在文字前。
     */
    async generateFigureSvg(imageBase64: string, mimeType: string, questionText?: string | null): Promise<FigureResult> {
        const { generateFigureRequest } = await import('./prompt-requests');
        const prompt = generateFigureRequest(questionText);
        logger.info({ provider: this.providerName, model: this.model, imageSize: imageBase64.length }, 'Figure SVG Request');

        try {
            const text = await this.run({
                task: 'figure',
                system: prompt.system,
                user: prompt.user,
                image: { base64: imageBase64, mimeType },
            });
            logger.debug({ rawResponse: text }, 'Figure SVG AI raw response');
            return parseFigure(extractTag(text, "has_figure"), extractTag(text, "figure_svg"));
        } catch (error) {
            logger.error({ error, stack: error instanceof Error ? error.stack : undefined }, 'Error during figure SVG generation');
            this.handleError(error);
            throw error;
        }
    }

    protected handleError(error: unknown): void {
        logger.error({ error }, 'OpenAI error');
        if (error instanceof Error) {
            if (error.message === AI_OUTPUT_TRUNCATED || error.message.startsWith('AI_RESPONSE_ERROR:')) {
                throw error;
            }
            const msg = error.message.toLowerCase();
            if (msg.includes('fetch failed') || msg.includes('network') || msg.includes('connect')) {
                throw new Error("AI_CONNECTION_FAILED", { cause: error });
            }
            // 超时错误 (包括 408 Request Timeout)
            if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted') || msg.includes('408')) {
                throw new Error("AI_TIMEOUT_ERROR", { cause: error });
            }
            // 配额/频率限制错误
            if (msg.includes('quota') || msg.includes('额度') || msg.includes('rate limit') || msg.includes('429') || msg.includes('too many')) {
                throw new Error("AI_QUOTA_EXCEEDED", { cause: error });
            }
            // 权限/403 错误
            if (msg.includes('403') || msg.includes('forbidden') || msg.includes('permission')) {
                throw new Error("AI_PERMISSION_DENIED", { cause: error });
            }
            // 资源不存在/404 错误
            if (msg.includes('404') || msg.includes('not found') || msg.includes('does not exist')) {
                throw new Error("AI_NOT_FOUND", { cause: error });
            }
            // 服务器错误 (500/502/503/504)
            if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504') ||
                msg.includes('无可用') || msg.includes('overloaded') || msg.includes('unavailable')) {
                throw new Error("AI_SERVICE_UNAVAILABLE", { cause: error });
            }
            if (msg.includes('invalid json') || msg.includes('parse')) {
                throw new Error("AI_RESPONSE_ERROR", { cause: error });
            }
            if (msg.includes('api key') || msg.includes('unauthorized') || msg.includes('401')) {
                throw new Error("AI_AUTH_ERROR", { cause: error });
            }
        }
        throw new Error("AI_UNKNOWN_ERROR", { cause: error });
    }
}
