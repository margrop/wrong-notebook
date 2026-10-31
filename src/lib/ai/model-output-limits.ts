/**
 * 已知模型的最大输出 token（max_tokens 上限）。
 *
 * 推理模型的思考过程也计入输出额度，截断重试时应尽量用满模型允许的上限。
 * 未收录的模型先用默认值重试，
 * 接口报 max_tokens 超限时再从错误信息中读出真实上限并记住（见 truncation.ts）。
 */

interface ModelOutputLimit {
    pattern: RegExp;
    maxOutputTokens: number;
}

/**
 * 按顺序匹配，先写更具体的规则。数据核对于 2026-10-31：
 * 官方文档标注“K”的按 1000 换算（宁可略低，超限时 truncation.ts 会从报错中读出真实上限）。
 * 官方未公布的模型（MiniMax、Kimi K3、千问 3.8）取第三方渠道数据中较低的值；阶跃星辰未收录。
 */
const MODEL_OUTPUT_LIMITS: ModelOutputLimit[] = [
    // Anthropic Claude（platform.claude.com 模型总览）：5 系列与 4.6 及以后为 128K；4.5、Sonnet 4 为 64K；Opus 4 / 4.1 为 32K
    { pattern: /claude-(opus|sonnet|haiku|fable|mythos)-([5-9]|4[-.][6-9])/, maxOutputTokens: 128000 },
    { pattern: /claude-(opus|sonnet|haiku)-4[-.]5/, maxOutputTokens: 64000 },
    { pattern: /claude-sonnet-4/, maxOutputTokens: 64000 },
    { pattern: /claude-opus-4/, maxOutputTokens: 32000 },
    { pattern: /claude-3[-.]7-sonnet/, maxOutputTokens: 64000 },
    { pattern: /claude-3[-.]5-/, maxOutputTokens: 8192 },
    { pattern: /claude-3-/, maxOutputTokens: 4096 },
    // OpenAI（developers.openai.com 模型页）：GPT-6.x、GPT-5.x 为 128K
    { pattern: /(^|[/-])gpt-[5-9]/, maxOutputTokens: 128000 },
    { pattern: /(^|[/-])o1-mini/, maxOutputTokens: 65536 },
    { pattern: /(^|[/-])o1-preview/, maxOutputTokens: 32768 },
    { pattern: /(^|[/-])o[134](-|$)/, maxOutputTokens: 100000 },
    { pattern: /(^|[/-])gpt-4\.1/, maxOutputTokens: 32768 },
    { pattern: /(^|[/-])gpt-4o/, maxOutputTokens: 16384 },
    { pattern: /(^|[/-])gpt-4-(turbo|vision|1106|0125)/, maxOutputTokens: 4096 },
    { pattern: /(^|[/-])gpt-4(-|$)/, maxOutputTokens: 8192 },
    { pattern: /(^|[/-])gpt-3\.5/, maxOutputTokens: 4096 },
    // Google Gemini（经 OpenAI 兼容接口或中转调用时；Gemini 提供商本身不限制输出）：2.5、3.x、4 同步请求为 65536
    { pattern: /gemini-(2\.5|[3-9])/, maxOutputTokens: 65536 },
    { pattern: /gemini-(1\.5|2\.0)/, maxOutputTokens: 8192 },
    // DeepSeek（官方价格页）：V4 系列最大输出 384K；旧别名 deepseek-chat / deepseek-reasoner 未注明，不收录
    { pattern: /^deepseek-(flash|v4)/, maxOutputTokens: 384000 },
    // 智谱 GLM（官方模型概览）
    { pattern: /^glm-4\.6v/, maxOutputTokens: 32000 },
    { pattern: /^glm-(5|4\.7|4\.6)/, maxOutputTokens: 128000 },
    { pattern: /^glm-4\.5/, maxOutputTokens: 96000 },
    { pattern: /^glm-4\.1v/, maxOutputTokens: 16000 },
    { pattern: /^glm-4-long/, maxOutputTokens: 4000 },
    { pattern: /^glm-4v-flash/, maxOutputTokens: 1000 },
    { pattern: /^glm-4-flash/, maxOutputTokens: 16000 },
    // 火山引擎豆包（官方模型列表“最大回答”）
    { pattern: /^doubao-seed-character/, maxOutputTokens: 32000 },
    { pattern: /^doubao-seed-(evolving|2-1)/, maxOutputTokens: 256000 },
    { pattern: /^doubao-seed-2-0/, maxOutputTokens: 128000 },
    // 官方未公布，取第三方数据的较低值
    { pattern: /^minimax-m3/, maxOutputTokens: 128000 },
    { pattern: /^kimi-k3/, maxOutputTokens: 131072 },
    { pattern: /^qwen3\.8-max/, maxOutputTokens: 128000 },
];

/** 返回已知模型的最大输出 token；未知模型返回 undefined */
export function getKnownModelMaxOutputTokens(model: string | null | undefined): number | undefined {
    const name = (model || '').trim().toLowerCase();
    if (!name) return undefined;
    return MODEL_OUTPUT_LIMITS.find((limit) => limit.pattern.test(name))?.maxOutputTokens;
}

/** 输出上限的下限：低于此值的数字不视为模型上限（避免误读错误信息中的其他数字） */
const MIN_PARSED_LIMIT = 1024;

/**
 * 从接口错误信息中读取模型允许的最大输出 token。
 * 常见格式：
 * - OpenAI：`max_tokens is too large: 65536. This model supports at most 16384 completion tokens`
 * - Anthropic：`max_tokens: 65536 > 64000, which is the maximum allowed number of output tokens`
 * - DeepSeek / 千问等：`the valid range of max_tokens is [1, 8192]`
 * 取小于请求值的最大数字；读不出时返回 undefined。
 */
export function parseMaxOutputTokensFromError(message: string, requested: number): number | undefined {
    if (!/max[_ ]?(completion[_ ]?|output[_ ]?)?tokens|output tokens|completion tokens/i.test(message)) {
        return undefined;
    }
    const numbers = (message.match(/\d+/g) || [])
        .map(Number)
        .filter((value) => Number.isSafeInteger(value) && value >= MIN_PARSED_LIMIT && value < requested);
    return numbers.length > 0 ? Math.max(...numbers) : undefined;
}

/** 错误是否与输出上限参数有关（读不出具体数字时用于判断是否值得降低上限再试） */
export function isMaxTokensError(message: string): boolean {
    return /max[_ ]?(completion[_ ]?|output[_ ]?)?tokens/i.test(message);
}
