/**
 * 推理模型（如 MiniMax、DeepSeek-R1）会先输出思考过程，思考过长时会把 max_tokens 全部用完，
 * 返回 finish_reason = "length" 且正文为空或只有一半（如配图 SVG 较长时）。
 * 此时按模型的最大输出重试一次：已知模型用其官方上限，未知模型先试 UNKNOWN_MODEL_RETRY_MAX_TOKENS，
 * 接口报 max_tokens 超限时从错误信息读出真实上限再试并记住。
 * 仍没有正文则报明确错误，仍只有部分正文时返回该结果尽力解析。
 */

import { getErrorMessage } from '../error-message';
import { createLogger } from '../logger';
import { getKnownModelMaxOutputTokens, isMaxTokensError, parseMaxOutputTokensFromError } from './model-output-limits';

const logger = createLogger('ai:truncation');

export const AI_OUTPUT_TRUNCATED = 'AI_OUTPUT_TRUNCATED';

/** 未知模型截断后重试使用的输出上限 */
export const UNKNOWN_MODEL_RETRY_MAX_TOKENS = 65536;

/** 接口拒绝更大上限且读不出具体数字时的保底上限 */
export const TRUNCATION_RETRY_MAX_TOKENS = 32768;

/** 运行期从接口错误中读出的模型输出上限，按模型名记录 */
const learnedLimits = new Map<string, number>();

/** 仅供测试：清空运行期记录的模型上限 */
export function resetLearnedOutputLimits(): void {
    learnedLimits.clear();
}

/** 模型的最大输出 token：优先使用运行期读出的值，其次是已知模型表 */
export function getModelMaxOutputTokens(model?: string): number | undefined {
    const key = model?.trim().toLowerCase();
    const learned = key ? learnedLimits.get(key) : undefined;
    return learned ?? getKnownModelMaxOutputTokens(key);
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
 * 以 limit 调用；接口报 max_tokens 超限时改用错误信息中的上限（读不出时用保底值）再调用一次
 */
async function callWithinModelLimit<T>(
    call: (maxTokens: number) => Promise<T>,
    limit: number,
    model?: string
): Promise<{ response: T; limit: number }> {
    try {
        return { response: await call(limit), limit };
    } catch (error) {
        const message = getErrorMessage(error);
        const parsed = parseMaxOutputTokensFromError(message, limit);
        const next = parsed
            ?? (isMaxTokensError(message) && limit > TRUNCATION_RETRY_MAX_TOKENS ? TRUNCATION_RETRY_MAX_TOKENS : undefined);
        if (!next) throw error;
        const key = model?.trim().toLowerCase();
        if (key && parsed) learnedLimits.set(key, parsed);
        logger.warn({ model, requested: limit, adjusted: next }, 'max_tokens exceeds model limit, retrying with model limit');
        return { response: await call(next), limit: next };
    }
}

/**
 * 以 maxTokens 调用一次（不超过模型上限）；若因长度截断，用模型允许的最大输出重试一次
 */
export async function withTruncationRetry<T extends ChatCompletionLike>(
    call: (maxTokens: number) => Promise<T>,
    maxTokens: number,
    onRetry?: () => void,
    model?: string
): Promise<T> {
    const knownMax = getModelMaxOutputTokens(model);
    const first = await callWithinModelLimit(call, knownMax ? Math.min(maxTokens, knownMax) : maxTokens, model);
    if (!isTruncated(first.response)) {
        return first.response;
    }

    // 第一次调用可能刚从错误中读出上限，重新取一次
    const retryLimit = getModelMaxOutputTokens(model) ?? UNKNOWN_MODEL_RETRY_MAX_TOKENS;
    if (first.limit >= retryLimit) {
        if (isTruncatedWithoutContent(first.response)) throw new Error(AI_OUTPUT_TRUNCATED);
        return first.response;
    }
    onRetry?.();
    const second = await callWithinModelLimit(call, retryLimit, model);
    if (isTruncatedWithoutContent(second.response)) {
        throw new Error(AI_OUTPUT_TRUNCATED);
    }
    return second.response;
}
