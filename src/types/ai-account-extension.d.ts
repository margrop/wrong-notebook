/**
 * 构建时替换的 AI 账户扩展模块：next.config.ts 与 vitest.config.mts 把它指向
 * AI_ACCOUNT_EXTENSION 指定的文件，未指定时指向 src/lib/ai/account-default.ts。
 * 扩展模块必须导出名为 aiAccountProvider 的实现。
 */
declare module '@wrong-notebook/ai-account' {
    export const aiAccountProvider: import('@/lib/ai/account').AiAccountProvider;
}
