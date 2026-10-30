import fs from 'fs';
import path from 'path';
import { createLogger } from './logger';
import { DEFAULT_TIME_ZONE, isValidTimeZone } from './date-time';
import { VENDOR_PROVIDER_IDS, VENDOR_PRESETS } from './ai/vendor-presets';
import type { VendorConfig, VendorProviderId } from './ai/vendor-presets';
import type { MiniMaxCodeConfig } from './minimax-code/constants';
import { CLOUD_TTS_PROVIDERS, isTtsMode } from './tts/constants';
import type { TtsConfig } from './tts/constants';

const logger = createLogger('config');

// 安装包（npm、桌面端、飞牛OS）通过 CONFIG_DIR 把配置放到用户数据目录，默认仍为 ./config
const CONFIG_FILE_PATH = path.join(process.env.CONFIG_DIR || path.join(process.cwd(), 'config'), 'app-config.json');

// OpenAI 实例配置
export interface OpenAIInstance {
    id: string;           // 唯一标识 (UUID)
    name: string;         // 用户自定义名称
    apiKey: string;
    baseUrl: string;
    model: string;
}

// MiniMax、GLM 等国产大模型官方渠道（OpenAI 兼容接口），每个渠道一组配置
type VendorConfigs = { [K in VendorProviderId]?: VendorConfig };

export interface AppConfig extends VendorConfigs {
    aiProvider: 'gemini' | 'openai' | 'azure' | 'anthropic' | 'minimax-code' | VendorProviderId;
    allowRegistration?: boolean;
    /** 普通用户每天可发起的 AI 调用次数，0 表示不限制；管理员不受限制 */
    aiDailyLimit?: number;
    timeZone?: string;
    /** 管理员完成（或跳过）安装向导的时间，ISO 字符串；未设置时新安装会自动进入向导 */
    setupCompletedAt?: string;
    openai?: {
        instances?: OpenAIInstance[];
        activeInstanceId?: string;
    };
    gemini?: {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
    };
    azure?: {
        apiKey?: string;
        endpoint?: string;       // Azure 资源端点 (https://xxx.openai.azure.com)
        deploymentName?: string; // 部署名称
        apiVersion?: string;     // API 版本
        model?: string;          // 显示用模型名
    };
    // Anthropic 及兼容接口（baseUrl 不含 /v1，如 https://api.anthropic.com）
    anthropic?: {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
    };
    // MiniMax Code OAuth 渠道：模型与自动签到开关；登录凭据另存于 minimax-code.json
    minimaxCode?: MiniMaxCodeConfig;
    prompts?: {
        analyze?: string;
        similar?: string;
    };
    timeouts?: {
        analyze?: number; // 毫秒
    };
    /** 动画语音讲解的朗读方式：浏览器本地语音或云端语音合成 */
    tts?: TtsConfig;
}

// 旧版 OpenAI 配置格式（用于迁移检测）
interface LegacyOpenAIConfig {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
}

// 检测是否为旧版配置格式
function isLegacyOpenAIConfig(config: unknown): config is LegacyOpenAIConfig {
    if (!config || typeof config !== 'object') return false;
    // 旧版配置包含 apiKey 直接字段，而新版包含 instances 数组
    return 'apiKey' in config && !('instances' in config);
}

// 生成唯一 ID
function generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// 迁移旧版 OpenAI 配置到新版多实例格式
function migrateOpenAIConfig(legacy: LegacyOpenAIConfig): AppConfig['openai'] {
    if (!legacy.apiKey) {
        // 没有有效配置，返回空实例数组
        return { instances: [], activeInstanceId: undefined };
    }

    const defaultInstance: OpenAIInstance = {
        id: generateId(),
        name: 'Default',
        apiKey: legacy.apiKey,
        baseUrl: legacy.baseUrl || 'https://api.openai.com/v1',
        model: legacy.model || 'gpt-6.1-sol',
    };

    return {
        instances: [defaultInstance],
        activeInstanceId: defaultInstance.id,
    };
}

/** 每日额度只接受非负整数，其余取值视为不限制 */
export function parseDailyLimit(value: unknown): number {
    const limit = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(limit) && limit > 0 ? limit : 0;
}

const DEFAULT_CONFIG: AppConfig = {
    aiProvider: (process.env.AI_PROVIDER as AppConfig['aiProvider']) || 'minimax',
    // 默认关闭注册，避免公网部署时陌生人注册并消耗 AI 额度；管理员可在用户管理中开启
    allowRegistration: process.env.ALLOW_REGISTRATION === 'true',
    aiDailyLimit: parseDailyLimit(process.env.AI_DAILY_LIMIT),
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
function mergeVendorConfigs(base: Partial<AppConfig>, override: Partial<AppConfig>): VendorConfigs {
    return Object.fromEntries(VENDOR_PROVIDER_IDS.map((id) => [id, { ...base[id], ...override[id] }]));
}

/** 朗读方式与各云端语音的设置分别合并 */
function mergeTtsConfig(base: TtsConfig | undefined, override: TtsConfig | undefined): TtsConfig {
    return {
        mode: override?.mode ?? base?.mode ?? 'browser',
        ...Object.fromEntries(CLOUD_TTS_PROVIDERS.map((id) => [id, { ...base?.[id], ...override?.[id] }])),
    };
}

/** 读取配置文件；文件不存在时返回 null（直接读取并处理 ENOENT，避免先判断再读取之间文件被改动） */
function readConfigFile(): string | null {
    try {
        return fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
        throw error;
    }
}

/** 先写临时文件再改名替换，避免其他请求读到写了一半的配置 */
function writeConfigFile(config: unknown): void {
    const tmp = `${CONFIG_FILE_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, CONFIG_FILE_PATH);
}

export function getAppConfig(): AppConfig {
    let fileContent: string | null;
    try {
        fileContent = readConfigFile();
    } catch (error) {
        logger.error({ error }, 'Failed to read config file');
        return DEFAULT_CONFIG;
    }
    if (fileContent !== null) {
        try {
            const userConfig = JSON.parse(fileContent);

            // 检测并迁移旧版 OpenAI 配置
            let openaiConfig = userConfig.openai;
            if (isLegacyOpenAIConfig(userConfig.openai)) {
                logger.info('Detected legacy OpenAI config, migrating to multi-instance format...');
                openaiConfig = migrateOpenAIConfig(userConfig.openai);
                // 持久化迁移结果
                const migratedConfig = {
                    ...userConfig,
                    openai: openaiConfig,
                };
                writeConfigFile(migratedConfig);
                logger.info('Legacy OpenAI config migrated successfully');
            }

            // Merge with default to ensure all fields exist
            return {
                ...DEFAULT_CONFIG,
                ...userConfig,
                timeZone: isValidTimeZone(userConfig.timeZone) ? userConfig.timeZone.trim() : DEFAULT_TIME_ZONE,
                openai: {
                    instances: openaiConfig?.instances || DEFAULT_CONFIG.openai?.instances || [],
                    activeInstanceId: openaiConfig?.activeInstanceId || DEFAULT_CONFIG.openai?.activeInstanceId,
                },
                gemini: { ...DEFAULT_CONFIG.gemini, ...userConfig.gemini },
                azure: { ...DEFAULT_CONFIG.azure, ...userConfig.azure },
                anthropic: { ...DEFAULT_CONFIG.anthropic, ...userConfig.anthropic },
                minimaxCode: { ...DEFAULT_CONFIG.minimaxCode, ...userConfig.minimaxCode },
                ...mergeVendorConfigs(DEFAULT_CONFIG, userConfig),
                prompts: { ...DEFAULT_CONFIG.prompts, ...userConfig.prompts },
                timeouts: { ...DEFAULT_CONFIG.timeouts, ...userConfig.timeouts },
                tts: mergeTtsConfig(DEFAULT_CONFIG.tts, userConfig.tts),
            };
        } catch (error) {
            logger.error({ error }, 'Failed to read config file');
            return DEFAULT_CONFIG;
        }
    }
    return DEFAULT_CONFIG;
}

export function updateAppConfig(newConfig: Partial<AppConfig>) {
    if (newConfig.timeZone !== undefined && !isValidTimeZone(newConfig.timeZone)) {
        throw new Error('INVALID_TIME_ZONE');
    }
    const currentConfig = getAppConfig();
    const updatedConfig = {
        ...currentConfig,
        ...newConfig,
        timeZone: newConfig.timeZone?.trim() ?? currentConfig.timeZone ?? DEFAULT_TIME_ZONE,
        openai: {
            instances: newConfig.openai?.instances ?? currentConfig.openai?.instances ?? [],
            activeInstanceId: newConfig.openai?.activeInstanceId ?? currentConfig.openai?.activeInstanceId,
        },
        gemini: { ...currentConfig.gemini, ...newConfig.gemini },
        azure: { ...currentConfig.azure, ...newConfig.azure },
        anthropic: { ...currentConfig.anthropic, ...newConfig.anthropic },
        minimaxCode: { ...currentConfig.minimaxCode, ...newConfig.minimaxCode },
        ...mergeVendorConfigs(currentConfig, newConfig),
        prompts: { ...currentConfig.prompts, ...newConfig.prompts },
        timeouts: { ...currentConfig.timeouts, ...newConfig.timeouts },
        tts: mergeTtsConfig(currentConfig.tts, newConfig.tts),
    };

    try {
        writeConfigFile(updatedConfig);
        return updatedConfig;
    } catch (error) {
        logger.error({ error }, 'Failed to write config file');
        throw error;
    }
}

export function getAppTimeZone(): string {
    return getAppConfig().timeZone || DEFAULT_TIME_ZONE;
}

// 获取当前激活的 OpenAI 实例配置
export function getActiveOpenAIConfig(): OpenAIInstance | undefined {
    const config = getAppConfig();
    const instances = config.openai?.instances || [];
    const activeId = config.openai?.activeInstanceId;

    if (!activeId || instances.length === 0) {
        return undefined;
    }

    return instances.find(i => i.id === activeId);
}

// 最大实例数限制
export const MAX_OPENAI_INSTANCES = 10;

