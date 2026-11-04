import { DEFAULT_TIME_ZONE } from '../date-time';
import { parseConcurrencyLimit } from '../ai-concurrency-limit';
import { VENDOR_PROVIDER_IDS, VENDOR_PRESETS } from '../ai/vendor-presets';
import { CLOUD_TTS_PROVIDERS, isTtsMode } from '../tts/constants';
import type { AppConfig } from './types';
import type { VendorConfigs } from './types';
import type { TtsConfig } from '../tts/constants';

/** 每日额度只接受非负整数，其余取值视为不限制 */
export function parseDailyLimit(value: unknown): number {
    const limit = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(limit) && limit > 0 ? limit : 0;
}

export const DEFAULT_CONFIG: AppConfig = {
    aiProvider: (process.env.AI_PROVIDER as AppConfig['aiProvider']) || 'minimax',
    // 默认关闭注册，避免公网部署时陌生人注册并消耗 AI 额度；管理员可在用户管理中开启
    allowRegistration: process.env.ALLOW_REGISTRATION === 'true',
    aiDailyLimit: parseDailyLimit(process.env.AI_DAILY_LIMIT),
    aiConcurrencyLimit: parseConcurrencyLimit(process.env.AI_CONCURRENCY_LIMIT),
    timeZone: DEFAULT_TIME_ZONE,
    openai: {
        instances: process.env.OPENAI_API_KEY ? [{
            id: 'env-default',
            name: 'Default (ENV)',
            apiKey: process.env.OPENAI_API_KEY,
            baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
            model: process.env.OPENAI_MODEL || 'gpt-6.1-sol',
        }] : [],
        activeInstanceId: process.env.OPENAI_API_KEY ? 'env-default' : undefined,
    },
    gemini: {
        apiKey: process.env.GOOGLE_API_KEY,
        baseUrl: process.env.GEMINI_BASE_URL,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    },
    azure: {
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT,
        apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',
        model: process.env.AZURE_OPENAI_MODEL || 'gpt-4o',
    },
    anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseUrl: process.env.ANTHROPIC_BASE_URL,
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    },
    minimaxCode: {
        model: process.env.MINIMAX_CODE_MODEL,
        autoCheckin: process.env.MINIMAX_CODE_AUTO_CHECKIN !== 'false',
    },
    // 动画语音讲解默认用浏览器本地语音；TTS_MODE 为 minimax、qwen 等时改用云端语音合成
    tts: {
        mode: isTtsMode(process.env.TTS_MODE) ? process.env.TTS_MODE : 'browser',
        // 火山引擎豆包语音的 Key 与火山方舟不同，单独配置
        volcengine: { apiKey: process.env.VOLCENGINE_TTS_API_KEY },
    },
    ...Object.fromEntries(VENDOR_PROVIDER_IDS.map((id) => {
        const prefix = VENDOR_PRESETS[id].envPrefix;
        return [id, {
            apiKey: process.env[`${prefix}_API_KEY`],
            baseUrl: process.env[`${prefix}_BASE_URL`],
            model: process.env[`${prefix}_MODEL`],
        }];
    })),
    prompts: {
        analyze: '',
        similar: '',
    },
    timeouts: {
        analyze: 180000,
    },
};

// 合并各国产大模型渠道的配置，保证每个渠道都有对象
export function mergeVendorConfigs(base: Partial<AppConfig>, override: Partial<AppConfig>): VendorConfigs {
    return Object.fromEntries(VENDOR_PROVIDER_IDS.map((id) => [id, { ...base[id], ...override[id] }]));
}

/** 朗读方式与各云端语音的设置分别合并 */
export function mergeTtsConfig(base: TtsConfig | undefined, override: TtsConfig | undefined): TtsConfig {
    return {
        mode: override?.mode ?? base?.mode ?? 'browser',
        ...Object.fromEntries(CLOUD_TTS_PROVIDERS.map((id) => [id, { ...base?.[id], ...override?.[id] }])),
    };
}
