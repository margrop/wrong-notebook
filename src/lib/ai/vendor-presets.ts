/**
 * 国产大模型官方渠道预设：均通过 OpenAI 兼容接口调用，复用 OpenAIProvider。
 * 本文件不依赖 Node 模块，前端设置界面也会引用。
 */

export interface VendorPreset {
    name: string;        // 显示名称
    baseUrl: string;     // 官方 OpenAI 兼容地址（中国大陆）
    model: string;       // 默认模型（当前最新、支持图片输入）
    envPrefix: string;   // 环境变量前缀：<PREFIX>_API_KEY / _BASE_URL / _MODEL
    consoleUrl: string;  // 获取 API Key 的控制台
}

export const VENDOR_PRESETS = {
    minimax: {
        name: 'MiniMax',
        baseUrl: 'https://api.minimax.cn/v1',
        model: 'MiniMax-M3.1-Flash',
        envPrefix: 'MINIMAX',
        consoleUrl: 'https://platform.minimax.cn',
    },
    glm: {
        name: '智谱 GLM',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'glm-5.3-flash',
        envPrefix: 'GLM',
        consoleUrl: 'https://open.bigmodel.cn',
    },
    deepseek: {
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        envPrefix: 'DEEPSEEK',
        consoleUrl: 'https://platform.deepseek.com',
    },
    kimi: {
        name: 'Kimi',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k3',
        envPrefix: 'KIMI',
        consoleUrl: 'https://platform.kimi.com',
    },
    // 默认为百炼 Token Plan 专属地址（Key 以 sk-sp- 开头）；按量付费的 Key 改用 https://dashscope.aliyuncs.com/compatible-mode/v1
    qwen: {
        name: '千问 Qwen',
        baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3.8-max',
        envPrefix: 'QWEN',
        consoleUrl: 'https://bailian.console.aliyun.com',
    },
} as const satisfies Record<string, VendorPreset>;

export type VendorProviderId = keyof typeof VENDOR_PRESETS;

export const VENDOR_PROVIDER_IDS = Object.keys(VENDOR_PRESETS) as VendorProviderId[];

export interface VendorConfig {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
}

export function isVendorProvider(provider: unknown): provider is VendorProviderId {
    return typeof provider === 'string' && Object.prototype.hasOwnProperty.call(VENDOR_PRESETS, provider);
}

/** 未填写的地址和模型使用官方默认值 */
export function resolveVendorConfig(provider: VendorProviderId, config?: VendorConfig): Required<VendorConfig> {
    const preset = VENDOR_PRESETS[provider];
    return {
        apiKey: config?.apiKey || '',
        baseUrl: config?.baseUrl || preset.baseUrl,
        model: config?.model || preset.model,
    };
}
