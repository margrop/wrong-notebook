/**
 * AI 错误消息 → 标准化错误代码的单一归类逻辑。
 * 前端负责翻译错误码显示给用户。
 *
 * 规则来源：合并 base-provider.ts handleError、anthropic-provider.ts handleError
 * 与 ai/test 路由 parseErrorCode 的关键词匹配，取最完整并集。
 */

const AI_ERROR_CODES = [
    'AI_CONNECTION_FAILED', 'AI_TIMEOUT_ERROR', 'AI_QUOTA_EXCEEDED',
    'AI_PERMISSION_DENIED', 'AI_NOT_FOUND', 'AI_RESPONSE_ERROR',
    'AI_AUTH_ERROR', 'AI_SERVICE_UNAVAILABLE', 'AI_UNKNOWN_ERROR'
] as const;

export type AIErrorCode = typeof AI_ERROR_CODES[number];

/**
 * 判断错误消息中是否已包含标准 AI 错误码（AI Provider 已归类过）。
 */
export function isAIErrorCode(msg: string): boolean {
    return AI_ERROR_CODES.some(code => msg.includes(code));
}

/**
 * 解析错误并返回标准化错误代码。
 * 1. 若错误消息中已包含标准 AI 错误码（AI Provider 抛出），直接传递。
 * 2. 否则按关键词匹配归类原始错误消息。
 */
export function parseErrorCode(error: unknown): string {
    const msg = error instanceof Error ? error.message : String(error);
    const msgLower = msg.toLowerCase();

    // 1. 首先检查是否是 AI Provider 抛出的标准错误代码（直接传递）
    for (const code of AI_ERROR_CODES) {
        if (msg.includes(code)) {
            return code;
        }
    }

    // 2. 原始错误消息解析（用于非 AI Provider 错误）
    // 认证错误
    if (msgLower.includes('401') || msgLower.includes('unauthorized') || msgLower.includes('api key')) {
        return 'AI_AUTH_ERROR';
    }
    // 权限错误
    if (msgLower.includes('403') || msgLower.includes('forbidden') || msgLower.includes('permission')) {
        return 'AI_PERMISSION_DENIED';
    }
    // 资源不存在 / 模型不存在 / 404
    if (msgLower.includes('404') || msgLower.includes('not found') || msgLower.includes('does not exist')) {
        return 'AI_NOT_FOUND';
    }
    // 频率限制 / 配额
    if (msgLower.includes('429') || msgLower.includes('rate limit') || msgLower.includes('too many') || msgLower.includes('quota') || msgLower.includes('额度')) {
        return 'AI_QUOTA_EXCEEDED';
    }
    // 网络/连接错误
    if (msgLower.includes('fetch failed') || msgLower.includes('network') || msgLower.includes('connect') ||
        msgLower.includes('enotfound') || msgLower.includes('econnrefused') || msgLower.includes('etimedout') ||
        msgLower.includes('econnreset')) {
        return 'AI_CONNECTION_FAILED';
    }
    // 超时 (包括 408)
    if (msgLower.includes('timeout') || msgLower.includes('timed out') || msgLower.includes('aborted') || msgLower.includes('408')) {
        return 'AI_TIMEOUT_ERROR';
    }
    // 服务器错误
    if (msgLower.includes('500') || msgLower.includes('502') || msgLower.includes('503') || msgLower.includes('504') ||
        msgLower.includes('无可用') || msgLower.includes('overloaded') || msgLower.includes('unavailable')) {
        return 'AI_SERVICE_UNAVAILABLE';
    }
    // AI 响应格式错误
    if (msgLower.includes('invalid json') || msgLower.includes('parse') || msgLower.includes('json') || msgLower.includes('missing critical xml')) {
        return 'AI_RESPONSE_ERROR';
    }

    // 兜底：返回未知错误
    return 'AI_UNKNOWN_ERROR';
}
