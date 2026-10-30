/**
 * 国产大模型官方渠道预设：均通过 OpenAI 兼容接口调用，复用 OpenAIProvider。
 * 本文件不依赖 Node 模块，前端设置界面也会引用。
 */

export interface VendorPreset {
    name: string;        // 中文界面的显示名称
    nameEn: string;      // 英文界面的显示名称
    baseUrl: string;     // 官方 OpenAI 兼容地址（中国大陆）
    model: string;       // 默认模型（当前最新、支持图片输入）
    envPrefix: string;   // 环境变量前缀：<PREFIX>_API_KEY / _BASE_URL / _MODEL
    consoleUrl: string;  // 获取 API Key 的控制台
    /** 官方接入文档：国内站与国际站（只有一个入口时只填 cn） */
    docs: { cn: string; intl?: string };
}

export const VENDOR_PRESETS = {
    minimax: {
        name: 'MiniMax',
        nameEn: 'MiniMax',
        baseUrl: 'https://api.minimax.cn/v1',
        model: 'MiniMax-M3.1-Flash',
        envPrefix: 'MINIMAX',
        consoleUrl: 'https://platform.minimax.cn',
        docs: { cn: 'https://platform.minimax.cn/docs/api-reference/api-overview', intl: 'https://platform.minimax.io/docs/api-reference/api-overview' },
    },
    glm: {
        name: '智谱 GLM',
        nameEn: 'Zhipu GLM',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'glm-5.3-flash',
        envPrefix: 'GLM',
        consoleUrl: 'https://open.bigmodel.cn',
        docs: { cn: 'https://docs.bigmodel.cn/cn/guide/start/quick-start', intl: 'https://docs.z.ai/guides/overview/quick-start' },
    },
    deepseek: {
        name: 'DeepSeek',
        nameEn: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        envPrefix: 'DEEPSEEK',
        consoleUrl: 'https://platform.deepseek.com',
        docs: { cn: 'https://api-docs.deepseek.com/zh-cn/' },
    },
    kimi: {
        name: 'Kimi',
        nameEn: 'Kimi',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k3.1-pro',
        envPrefix: 'KIMI',
        consoleUrl: 'https://platform.kimi.com',
        docs: { cn: 'https://platform.moonshot.cn/docs/introduction', intl: 'https://platform.moonshot.ai/docs/introduction' },
    },
    // 默认为百炼 Token Plan 专属地址（Key 以 sk-sp- 开头）；按量付费的 Key 改用 https://dashscope.aliyuncs.com/compatible-mode/v1
    qwen: {
        name: '千问 Qwen',
        nameEn: 'Qwen',
        baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3.8-max',
        envPrefix: 'QWEN',
        consoleUrl: 'https://bailian.console.aliyun.com',
        docs: { cn: 'https://help.aliyun.com/zh/model-studio/token-plan-personal-quick-start', intl: 'https://www.alibabacloud.com/help/en/model-studio/token-plan-personal-quick-start' },
    },
    // 默认为 Step Plan 套餐地址（含语音合成）；按量付费改用 https://api.stepfun.com/v1，国际站为 https://api.stepfun.ai/v1
    stepfun: {
        name: '阶跃星辰 StepFun',
        nameEn: 'StepFun',
        baseUrl: 'https://api.stepfun.com/step_plan/v1',
        model: 'step-5-preview',
        envPrefix: 'STEPFUN',
        consoleUrl: 'https://platform.stepfun.com',
        docs: { cn: 'https://platform.stepfun.com/docs/zh/guides/developer/openai', intl: 'https://platform.stepfun.ai/docs/en/guides/developer/openai' },
    },
    // 火山方舟（豆包大模型）；推荐 Agent Plan、Coding Plan 等套餐，套餐的接口地址以火山引擎控制台为准。国际站为 BytePlus ModelArk
    volcengine: {
        name: '火山引擎 豆包',
        nameEn: 'Volcengine Doubao',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        model: 'doubao-seed-2-1-lite-260915',
        envPrefix: 'VOLCENGINE',
        consoleUrl: 'https://console.volcengine.com/ark',
        docs: { cn: 'https://www.volcengine.com/docs/82379/1330626', intl: 'https://docs.byteplus.com/en/docs/ModelArk/1330626' },
    },
    // 火山方舟 Agent Plan 套餐：专属地址与专属 API Key（在方舟控制台的 Agent Plan 管理页获取），套餐含豆包语音合成
    'volcengine-agent': {
        name: '火山引擎 Agent Plan',
        nameEn: 'Volcengine Agent Plan',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
        model: 'ark-code-latest',
        envPrefix: 'VOLCENGINE_AGENT',
        consoleUrl: 'https://console.volcengine.com/ark',
        docs: { cn: 'https://ark.volcengine.com/region:cn-beijing/docs/82379/2160841?lang=zh' },
    },
    // 火山方舟 Coding Plan 套餐：专属地址 /api/coding/v3（用 /api/v3 不计入套餐，会按量计费），套餐不含语音合成
    'volcengine-coding': {
        name: '火山引擎 Coding Plan',
        nameEn: 'Volcengine Coding Plan',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
        model: 'ark-code-latest',
        envPrefix: 'VOLCENGINE_CODING',
        consoleUrl: 'https://console.volcengine.com/ark',
        docs: { cn: 'https://www.volcengine.com/docs/82379/1928261' },
    },
    // 同为火山方舟，面向新用户的免费推理额度：每个模型有免费 token，开启「安心体验模式」后额度用完自动暂停，不产生费用
    'volcengine-free': {
        name: '火山引擎（免费试用）',
        nameEn: 'Volcengine (free trial)',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        model: 'doubao-seed-2-1-lite-260915',
        envPrefix: 'VOLCENGINE_FREE',
        consoleUrl: 'https://console.volcengine.com/ark',
        docs: { cn: 'https://www.volcengine.com/docs/82379/1399514' },
    },
} as const satisfies Record<string, VendorPreset>;

export type VendorProviderId = keyof typeof VENDOR_PRESETS;

export const VENDOR_PROVIDER_IDS = Object.keys(VENDOR_PRESETS) as VendorProviderId[];

export interface VendorConfig {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
}

/** 按界面语言取渠道的显示名称 */
export function getVendorName(provider: VendorProviderId, language: string): string {
    const preset = VENDOR_PRESETS[provider];
    return language === 'zh' ? preset.name : preset.nameEn;
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
