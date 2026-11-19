import 'server-only';

import OpenAI from 'openai';
import type { ResponseInputContent } from 'openai/resources/responses/responses';
import { normalizeHttpBaseUrl } from '../utils';
import { BaseAIProvider } from './base-provider';
import type { CompletionRequest } from './base-provider';
import { compactUsage, readRequestId } from './completion';
import type { CompletionResult } from './completion';
import { AI_IMAGE_NOT_SUPPORTED, isImageUnsupportedError } from './question-split';
import { AI_OUTPUT_TRUNCATED, withModelOutputLimit } from './truncation';
import type { VendorConfig } from './vendor-presets';

/** Responses API 的单轮文字和图片输入适配器 */
export class OpenAIResponsesProvider extends BaseAIProvider {
    protected readonly providerName = 'OpenAI Responses API';
    protected readonly configuredModel: string;
    private readonly client: OpenAI;

    constructor({ apiKey, baseUrl, model }: Required<VendorConfig>) {
        super();
        if (!apiKey) throw new Error('AI_AUTH_ERROR: OPENAI_RESPONSES_API_KEY is required');
        this.configuredModel = model;
        this.client = new OpenAI({ apiKey, baseURL: normalizeHttpBaseUrl(baseUrl) });
    }

    protected async complete(request: CompletionRequest): Promise<CompletionResult> {
        const textPart = { type: 'input_text', text: request.user } as const;
        const images = request.images?.length ? request.images : request.image ? [request.image] : [];
        const imageParts = images.map((image) => ({
            type: 'input_image',
            detail: 'auto',
            image_url: image.base64.startsWith('data:')
                ? image.base64
                : `data:${image.mimeType || 'image/jpeg'};base64,${image.base64}`,
        }) as const);
        const content: ResponseInputContent[] = request.task === 'figure'
            ? [...imageParts, textPart]
            : [textPart, ...imageParts];
        if (request.extraUserText) content.push({ type: 'input_text', text: request.extraUserText });

        const { result } = await withModelOutputLimit(async (maxTokens) => {
            const { data, response } = await this.client.responses.create({
                model: this.configuredModel,
                instructions: request.system,
                input: [{ role: 'user', content }],
                max_output_tokens: maxTokens,
                store: false,
            }, { signal: request.signal }).withResponse();

            // HTTP 成功时仍要检查生成状态；输出用尽且已有正文时沿用现有的部分解析逻辑。
            if (data?.error) throw new Error(`${data.error.code}: ${data.error.message}`);
            const truncated = data?.status === 'incomplete' && data.incomplete_details?.reason === 'max_output_tokens';
            if (data?.status && data.status !== 'completed' && !truncated) {
                throw new Error(`AI_RESPONSE_ERROR: Responses API status ${data.status}${data.incomplete_details?.reason ? ` (${data.incomplete_details.reason})` : ''}`);
            }
            // SDK 将独立的文本块汇总到 output_text，推理块不会进入正文。
            const text = typeof data?.output_text === 'string' ? data.output_text : '';
            return {
                result: {
                    text,
                    usage: compactUsage(data?.usage?.input_tokens, data?.usage?.output_tokens),
                    model: data?.model || undefined,
                    requestId: readRequestId(response.headers),
                },
                choices: [{ finish_reason: truncated ? 'length' : 'stop', message: { content: text } }],
            };
        }, this.configuredModel);

        if (!result.text.trim()) throw new Error('AI_RESPONSE_ERROR: Empty response from Responses API');
        return result;
    }

    protected handleError(error: unknown): void {
        if (error instanceof Error && error.message === AI_OUTPUT_TRUNCATED) throw error;
        if (isImageUnsupportedError(error)) throw new Error(AI_IMAGE_NOT_SUPPORTED, { cause: error });
        super.handleError(error);
    }
}
