/** 每日 AI 次数用完的提示文案，供 api-client 直接引用，避免把整份 translations 打包进客户端 */
export const AI_DAILY_LIMIT_MESSAGES: Record<'zh' | 'en', string> = {
    zh: "今天的 AI 使用次数已达上限，请明天再试，或请管理员调整额度。",
    en: "You have used up today's AI allowance. Try again tomorrow or ask an administrator to raise the limit.",
};
