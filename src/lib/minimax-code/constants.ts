/**
 * MiniMax Code 渠道的常量与配置类型。本文件不依赖 Node 模块，前端设置界面也会引用。
 */

/** MiniMax Code 的两个站点：中国大陆站与国际站，登录凭据互不通用 */
export type MiniMaxCodeSite = 'cn' | 'global';

export interface MiniMaxCodeSiteConfig {
    /** 账号与 OAuth 接口 */
    accountBase: string;
    /** 业务接口（积分、签到、资料） */
    agentBase: string;
    /** 传给 Anthropic SDK 的 baseURL，SDK 会拼接 /v1/messages */
    llmBaseUrl: string;
    /** 默认模型（支持图片输入） */
    defaultModel: string;
    /** 设置页可选的模型 */
    models: readonly string[];
}

export const MINIMAX_CODE_SITES: Record<MiniMaxCodeSite, MiniMaxCodeSiteConfig> = {
    cn: {
        accountBase: 'https://account.minimax.cn',
        agentBase: 'https://agent.minimax.cn',
        llmBaseUrl: 'https://agent.minimax.cn/mavis/api/v1/llm',
        defaultModel: 'MiniMax-M3.1-Flash',
        models: ['MiniMax-M3.1-Flash', 'MiniMax-M3', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.7'],
    },
    global: {
        accountBase: 'https://account.minimax.io',
        agentBase: 'https://agent.minimax.io',
        llmBaseUrl: 'https://agent.minimax.io/mavis/api/v1/llm',
        defaultModel: 'MiniMax-M3.1-Flash',
        models: ['MiniMax-M3.1-Flash', 'MiniMax-M3.1-Flash-Preview', 'MiniMax-M3', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.7'],
    },
};

export const MINIMAX_CODE_SITE_IDS = Object.keys(MINIMAX_CODE_SITES) as MiniMaxCodeSite[];

export function isMiniMaxCodeSite(value: unknown): value is MiniMaxCodeSite {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MINIMAX_CODE_SITES, value);
}

/** 路由 query 的 site 取值；缺省或非法时按中国站 */
export function resolveMiniMaxCodeSite(value: string | null | undefined): MiniMaxCodeSite {
    return isMiniMaxCodeSite(value) ? value : 'cn';
}

/** MiniMax Code 业务接口要求的客户端请求头（中国站与国际站相同） */
export const MINIMAX_CODE_HEADERS = {
    'User-Agent': 'MiniMaxAgent',
    'X-Mavis-Agent-Id': 'main',
} as const;

/** 默认模型（中国站） */
export const DEFAULT_MINIMAX_CODE_MODEL = MINIMAX_CODE_SITES.cn.defaultModel;
/** 设置页可选的模型（中国站） */
export const MINIMAX_CODE_MODELS = MINIMAX_CODE_SITES.cn.models;
/** 国际站默认模型 */
export const DEFAULT_MINIMAX_CODE_GLOBAL_MODEL = MINIMAX_CODE_SITES.global.defaultModel;
/** 国际站设置页可选的模型 */
export const MINIMAX_CODE_GLOBAL_MODELS = MINIMAX_CODE_SITES.global.models;

/** app-config.json 中 minimaxCode 的配置；登录凭据另存于 minimax-code.json，不在这里 */
export interface MiniMaxCodeConfig {
    model?: string;
    /** 每日自动签到，默认开启 */
    autoCheckin?: boolean;
}
