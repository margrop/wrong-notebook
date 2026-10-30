/** 取错误对象的消息，非 Error 时转为字符串 */
export function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * 取 apiClient 抛出的 ApiError 中后端返回的 message（错误码或提示），没有时返回 undefined。
 * 按结构判断而不用 instanceof，测试中模拟 api-client 时同样可用。
 */
export function getApiErrorMessage(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('data' in error)) return undefined;
    const { data } = error;
    if (typeof data !== 'object' || data === null || !('message' in data)) return undefined;
    return typeof data.message === 'string' ? data.message : undefined;
}

/** 取 ApiError 中后端返回的 details（如服务商的原始报错），不是文本时返回 undefined */
export function getApiErrorDetails(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('data' in error)) return undefined;
    const { data } = error;
    if (typeof data !== 'object' || data === null || !('details' in data)) return undefined;
    return typeof data.details === 'string' && data.details ? data.details : undefined;
}

/** 服务商原始报错的最大长度，避免把整页 HTML 等内容返回给前端 */
const MAX_ERROR_DETAIL_LENGTH = 500;

/**
 * 取错误的原始原因：AI 提供商把服务商的报错归类为 AI_* 错误码时，原始错误保存在 cause 中。
 * 返回最内层、不是错误码本身的消息，没有时返回 undefined
 */
export function getErrorDetail(error: unknown): string | undefined {
    let detail: string | undefined;
    let current: unknown = error;
    for (let depth = 0; current && depth < 5; depth++) {
        const message = current instanceof Error ? current.message : typeof current === 'string' ? current : undefined;
        if (message && !/^AI_[A-Z_]+$/.test(message)) detail = message;
        current = current instanceof Error ? current.cause : undefined;
    }
    const text = detail?.replace(/\s+/g, ' ').trim();
    if (!text) return undefined;
    return text.length > MAX_ERROR_DETAIL_LENGTH ? `${text.slice(0, MAX_ERROR_DETAIL_LENGTH)}…` : text;
}
