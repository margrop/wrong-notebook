/**
 * 单次 AI 补全的结果与观察者：各提供商的 complete 返回正文及 token 用量、实际模型和请求 ID，
 * 基类在每次补全结束（成功或失败）后通知观察者，用于记录用量。
 */

import { AI_OUTPUT_TRUNCATED } from './truncation';
import { parseErrorCode } from './error-classification';

/** 补全的 token 用量；服务商未返回时为空。输出包含推理模型的思考 token */
export interface CompletionUsage {
    inputTokens?: number;
    outputTokens?: number;
}

/** complete 的返回值 */
export interface CompletionResult {
    text: string;
    usage?: CompletionUsage;
    /** 服务商实际使用的模型（未返回时为配置的模型） */
    model?: string;
    /** 服务商或网关返回的请求 ID，用于与对方日志对应 */
    requestId?: string;
}

/** 一次补全结束后发给观察者的记录 */
export interface CompletionEvent {
    task: string;
    status: 'succeeded' | 'failed';
    durationMs: number;
    usage?: CompletionUsage;
    model?: string;
    requestId?: string;
    /** 失败时的标准错误码 */
    errorCode?: string;
}

export type CompletionObserver = (event: CompletionEvent) => void | Promise<void>;

/**
 * 依次查找的请求 ID 响应头：网关自身的 ID 优先（与网关日志对应），其次是 OpenAI、Anthropic、Azure 的请求 ID。
 */
const REQUEST_ID_HEADERS = ['x-oneapi-request-id', 'x-request-id', 'request-id', 'apim-request-id'] as const;

type HeaderSource = Headers | Record<string, string | string[] | undefined> | null | undefined;

/** 从响应头取请求 ID（不区分大小写），没有时返回 undefined */
export function readRequestId(headers: HeaderSource): string | undefined {
    if (!headers) return undefined;
    if (typeof (headers as Headers).get === 'function') {
        for (const name of REQUEST_ID_HEADERS) {
            const value = (headers as Headers).get(name)?.trim();
            if (value) return value;
        }
        return undefined;
    }
    const record = headers as Record<string, string | string[] | undefined>;
    const lowered = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
    for (const name of REQUEST_ID_HEADERS) {
        const raw = lowered.get(name);
        const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
        if (value) return value;
    }
    return undefined;
}

/** 只保留有效的非负整数 token 数 */
export function tokenCount(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

/** 输入、输出都为空时返回 undefined，避免记录空用量 */
export function compactUsage(inputTokens: unknown, outputTokens: unknown): CompletionUsage | undefined {
    const usage: CompletionUsage = { inputTokens: tokenCount(inputTokens), outputTokens: tokenCount(outputTokens) };
    return usage.inputTokens === undefined && usage.outputTokens === undefined ? undefined : usage;
}

/** 补全失败时记录的错误码：截断原样保留，其余按标准错误码归类 */
export function completionErrorCode(error: unknown): string {
    if (error instanceof Error && error.message === AI_OUTPUT_TRUNCATED) return AI_OUTPUT_TRUNCATED;
    return parseErrorCode(error);
}
