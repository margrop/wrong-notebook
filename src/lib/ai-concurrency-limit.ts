/**
 * 同一模型 AI 并发上限的默认值、范围与解析。
 * 本文件不依赖 Node 模块，服务端配置与前端设置界面共用。
 */

export const DEFAULT_AI_CONCURRENCY_LIMIT = 5;
export const MAX_AI_CONCURRENCY_LIMIT = 100;

/** 是否为合法的并发上限：1 到 MAX_AI_CONCURRENCY_LIMIT 的整数 */
export function isValidConcurrencyLimit(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_AI_CONCURRENCY_LIMIT;
}

/** 解析并发上限（可为环境变量字符串），不合法时使用默认值 */
export function parseConcurrencyLimit(value: unknown): number {
    const limit = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return isValidConcurrencyLimit(limit) ? limit : DEFAULT_AI_CONCURRENCY_LIMIT;
}
