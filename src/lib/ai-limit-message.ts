/**
 * 拒绝 AI 调用的错误码与额度用完的提示文案。
 * 只含常量和纯函数，客户端与服务端共用；api-client 直接引用文案，避免把整份 translations 打包进客户端。
 */

/** 额度用完：每日次数上限，或 AI 账户实现判定的额度不足（均返回 429） */
export const AI_LIMIT_CODES = ['AI_DAILY_LIMIT_EXCEEDED', 'AI_QUOTA_INSUFFICIENT'] as const;
export type AiLimitCode = typeof AI_LIMIT_CODES[number];

/** 调用前被拒绝、不向 AI 服务商发送数据的错误码：额度用完或尚未同意 AI 数据授权 */
export const AI_REJECTION_CODES = [...AI_LIMIT_CODES, 'AI_CONSENT_REQUIRED'] as const;
export type AiRejectionCode = typeof AI_REJECTION_CODES[number];

export function isAiLimitCode(value: unknown): value is AiLimitCode {
    return typeof value === 'string' && (AI_LIMIT_CODES as readonly string[]).includes(value);
}

export function isAiRejectionCode(value: unknown): value is AiRejectionCode {
    return typeof value === 'string' && (AI_REJECTION_CODES as readonly string[]).includes(value);
}

/** 每日 AI 次数用完的提示 */
export const AI_DAILY_LIMIT_MESSAGES: Record<'zh' | 'en', string> = {
    zh: "今天的 AI 使用次数已达上限，请明天再试，或请管理员调整额度。",
    en: "You have used up today's AI allowance. Try again tomorrow or ask an administrator to raise the limit.",
};

/** AI 额度不足的提示 */
export const AI_QUOTA_INSUFFICIENT_MESSAGES: Record<'zh' | 'en', string> = {
    zh: "AI 额度已用完，请补充额度后再试。",
    en: "Your AI credit has run out. Add more credit and try again.",
};

export const AI_LIMIT_MESSAGES: Record<AiLimitCode, Record<'zh' | 'en', string>> = {
    AI_DAILY_LIMIT_EXCEEDED: AI_DAILY_LIMIT_MESSAGES,
    AI_QUOTA_INSUFFICIENT: AI_QUOTA_INSUFFICIENT_MESSAGES,
};
