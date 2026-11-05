import "server-only";

import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger';
import { DEFAULT_TIME_ZONE, isValidTimeZone } from '../date-time';
import type { AppConfig } from './types';
import { DEFAULT_CONFIG, mergeTelemetryConfig, mergeTtsConfig, mergeVendorConfigs } from './defaults';
import { isLegacyOpenAIConfig, migrateOpenAIConfig } from './legacy';

const logger = createLogger('config');

// 安装包（npm、桌面端、飞牛OS）通过 CONFIG_DIR 把配置放到用户数据目录，默认仍为 ./config；
// 每次调用时计算，与 initial-admin、setup-token 一致
function configFilePath(): string {
    return path.join(process.env.CONFIG_DIR || path.join(process.cwd(), 'config'), 'app-config.json');
}

/** 读取配置文件；文件不存在时返回 null（直接读取并处理 ENOENT，避免先判断再读取之间文件被改动） */
function readConfigFile(): string | null {
    try {
        return fs.readFileSync(configFilePath(), 'utf-8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
        throw error;
    }
}

/** 先写临时文件再改名替换，避免其他请求读到写了一半的配置 */
function writeConfigFile(config: unknown): void {
    const file = configFilePath();
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, file);
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
                eula: { ...userConfig.eula },
                telemetry: mergeTelemetryConfig(undefined, userConfig.telemetry),
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
        eula: { ...currentConfig.eula, ...newConfig.eula },
        telemetry: mergeTelemetryConfig(currentConfig.telemetry, newConfig.telemetry),
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
