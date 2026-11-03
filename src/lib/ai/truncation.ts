/**
 * AI 调用的输出上限（max_tokens）：
 * 主流模型的最大输出已有数万到数十万 token，推理模型（如 MiniMax、DeepSeek）的思考过程也计入输出，
 * 默认的小上限会让思考把额度用完、正文为空，再重试反而更慢。因此每次调用直接按模型允许的最大输出请求：
 * 已知模型用其官方上限，未知模型用 DEFAULT_MAX_OUTPUT_TOKENS；接口报 max_tokens 超限时从错误信息读出真实上限
 * 再试并记住，读不出时依次降到 FALLBACK_MAX_OUTPUT_TOKENS 中的值。
 * 用满上限仍被截断且没有正文时报明确错误，只有部分正文时返回该结果尽力解析。
 */
import { getErrorMessage } from '../error-message';
import { createLogger } from '../logger';
import { getKnownModelMaxOutputTokens, isMaxTokensError, parseMaxOutputTokensFromError } from './model-output-limits';

const logger = createLogger('ai:truncation');

export const AI_OUTPUT_TRUNCATED = 'AI_OUTPUT_TRUNCATED';

/** 未收录模型的默认输出上限（256K） */
export const DEFAULT_MAX_OUTPUT_TOKENS = 262144;

/** 接口拒绝上限且读不出具体数字时，依次尝试的更小上限 */
export const FALLBACK_MAX_OUTPUT_TOKENS = [65536, 32768, 8192] as const;

/** 运行期从接口错误中读出的模型输出上限，按模型名记录 */
const learnedLimits = new Map<string, number>();

/** 仅供测试：清空运行期记录的模型上限 */
export function resetLearnedOutputLimits(): void {
    learnedLimits.clear();
}

/** 模型的最大输出 token：优先使用运行期读出的值，其次是已知模型表；未知时返回 undefined */
export function getModelMaxOutputTokens(model?: string): number | undefined {
    const key = model?.trim().toLowerCase();
    const learned = key ? learnedLimits.get(key) : undefined;
    return learned ?? getKnownModelMaxOutputTokens(key);
}

/** 本次调用使用的输出上限：模型允许的最大输出，未知模型用默认值 */
export function outputTokenLimit(model?: string): number {
    return getModelMaxOutputTokens(model) ?? DEFAULT_MAX_OUTPUT_TOKENS;
}

interface ChatCompletionLike {
    choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null } | null }>;
}

/** 是否因输出长度上限被截断 */
function isTruncated(response: ChatCompletionLike | null | undefined): boolean {
    return response?.choices?.[0]?.finish_reason === 'length';
}

/** 是否因输出长度上限被截断且没有任何正文 */
export function isTruncatedWithoutContent(response: ChatCompletionLike | null | undefined): boolean {
    const choice = response?.choices?.[0];
    return !!choice && choice.finish_reason === 'length' && !(choice.message?.content || '').trim();
}

/**
 * 以 limit 调用；接口报 max_tokens 超限时改用错误信息中的上限，读不出时依次降到保底值再调用
 */
async function callWithinModelLimit<T>(
    call: (maxTokens: number) => Promise<T>,
    limit: number,
    model?: string
): Promise<T> {
    let current = limit;
    for (;;) {
        try {
            return await call(current);
        } catch (error) {
            const message = getErrorMessage(error);
            const parsed = parseMaxOutputTokensFromError(message, current);
            const next = parsed ?? (isMaxTokensError(message) ? FALLBACK_MAX_OUTPUT_TOKENS.find((value) => value < current) : undefined);
            if (!next) throw error;
            const key = model?.trim().toLowerCase();
            if (key && parsed) learnedLimits.set(key, parsed);
            logger.warn({ model, requested: current, adjusted: next }, 'max_tokens exceeds model limit, retrying with model limit');
            current = next;
        }
    }
}

/**
 * 按模型允许的最大输出调用一次（接口拒绝时自动降到可用上限）；
 * 用满上限仍被截断且没有正文时报 AI_OUTPUT_TRUNCATED，有部分正文时返回由调用方尽力解析
 */
export async function withModelOutputLimit<T extends ChatCompletionLike>(
    call: (maxTokens: number) => Promise<T>,
    model?: string
): Promise<T> {
    const response = await callWithinModelLimit(call, outputTokenLimit(model), model);
    if (isTruncatedWithoutContent(response)) throw new Error(AI_OUTPUT_TRUNCATED);
    if (isTruncated(response)) logger.warn({ model }, 'Output truncated at model max_tokens, parsing partial content');
    return response;
}
