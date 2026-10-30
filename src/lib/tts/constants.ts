/**
 * 动画语音讲解的朗读方式与云端语音合成（TTS）的默认设置。
 * 本文件不依赖 Node 模块，前端设置界面也会引用。
 */
import { resolveVendorConfig } from "@/lib/ai/vendor-presets";
import type { VendorConfig } from "@/lib/ai/vendor-presets";

/** browser：浏览器本地语音（Web Speech API）；其余为服务端调用对应渠道的云端语音合成 */
export const TTS_MODES = ['browser', 'minimax', 'qwen', 'glm', 'stepfun', 'volcengine', 'volcengine-agent', 'openai'] as const;
export type TtsMode = typeof TTS_MODES[number];
export type CloudTtsProvider = Exclude<TtsMode, 'browser'>;

export interface CloudTtsSettings {
    model?: string;
    voice?: string;
    /** 完整的语音合成接口地址；留空时按对应渠道的 Base URL 推算 */
    endpoint?: string;
    /** 语音单独的 API Key（火山引擎豆包语音与火山方舟的 Key 不同）；其他语音复用对应渠道的 Key */
    apiKey?: string;
}

export type TtsConfig = { mode?: TtsMode } & { [K in CloudTtsProvider]?: CloudTtsSettings };

export const CLOUD_TTS_PROVIDERS = TTS_MODES.filter((mode): mode is CloudTtsProvider => mode !== 'browser');

/**
 * 默认音色：年轻男性，自然、清晰、略带科技感，不用播音腔、不模仿角色。
 * MiniMax 用系统音色「精英青年」；千问用 Qwen-Audio-TTS 的男声「龙安鲁风」（25 岁，明亮开朗），再用指令约束语气；
 * 智谱 GLM-TTS 用「小陈」（年轻、专业）；阶跃星辰用「青年大学生」，同样用指令约束语气；
 * 火山引擎（豆包语音、Agent Plan）用豆包语音合成模型 2.0（资源 ID seed-tts-2.0）的「阳光青年」；
 * OpenAI 用 gpt-4o-mini-tts 与官方推荐的 cedar，同样用指令约束语气
 */
export const CLOUD_TTS_DEFAULTS: Record<CloudTtsProvider, Required<Pick<CloudTtsSettings, 'model' | 'voice'>>> = {
    minimax: { model: 'speech-2.8-hd', voice: 'male-qn-jingying' },
    qwen: { model: 'qwen-audio-3.0-tts-plus', voice: 'longanlufeng' },
    glm: { model: 'glm-tts', voice: 'xiaochen' },
    stepfun: { model: 'stepaudio-2.5-tts', voice: 'qingniandaxuesheng' },
    volcengine: { model: 'seed-tts-2.0', voice: 'zh_male_yangguangqingnian_uranus_bigtts' },
    'volcengine-agent': { model: 'seed-tts-2.0', voice: 'zh_male_yangguangqingnian_uranus_bigtts' },
    openai: { model: 'gpt-4o-mini-tts', voice: 'cedar' },
};

/**
 * 在语音设置中填写 API Key 的语音：火山引擎豆包语音必须单独填写（与火山方舟不同）；
 * OpenAI 可单独填写，留空时使用「AI 设置」中当前的 OpenAI 配置。其他语音复用对应渠道的 Key
 */
export function hasOwnTtsApiKey(provider: CloudTtsProvider): boolean {
    return provider === 'volcengine' || provider === 'openai';
}

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** 读取语音复用的渠道配置所需的应用配置（前端与服务端的配置类型都满足） */
interface TtsChannelSource {
    openai?: { instances?: { id: string; apiKey: string; baseUrl: string }[]; activeInstanceId?: string };
}

/**
 * 语音复用的 AI 渠道配置（API Key、Base URL）：OpenAI 取「AI 设置」中当前激活的实例，其余取同名的国产大模型渠道
 */
export function getTtsChannelConfig(config: TtsChannelSource, provider: CloudTtsProvider): VendorConfig | undefined {
    if (provider === 'openai') {
        const instance = config.openai?.instances?.find((item) => item.id === config.openai?.activeInstanceId);
        return instance ? { apiKey: instance.apiKey, baseUrl: instance.baseUrl } : undefined;
    }
    return (config as Partial<Record<CloudTtsProvider, VendorConfig>>)[provider];
}

/** 火山引擎豆包语音的 HTTP 单向流式接口（与火山方舟的对话接口不同域名） */
export const VOLCENGINE_TTS_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
/** Agent Plan 套餐的豆包语音接口，使用 Agent Plan 的专属 API Key，计入套餐额度 */
export const VOLCENGINE_AGENT_TTS_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional';

/** 各云端语音的官方说明文档：获取 API Key、模型、音色（可选值列表）和接口地址，设置页附上链接 */
export const CLOUD_TTS_DOCS: Record<CloudTtsProvider, { apiKey: string; model: string; voice: string; endpoint: string }> = {
    minimax: {
        apiKey: 'https://platform.minimax.cn/docs/guides/quickstart-preparation',
        model: 'https://platform.minimax.cn/docs/api-reference/speech-t2a-http',
        voice: 'https://platform.minimax.cn/docs/faq/system-voice-id',
        endpoint: 'https://platform.minimax.cn/docs/api-reference/speech-t2a-http',
    },
    qwen: {
        apiKey: 'https://help.aliyun.com/zh/model-studio/token-plan-personal-quick-start',
        model: 'https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide',
        voice: 'https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list',
        endpoint: 'https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide',
    },
    // 模型、音色和接口说明都在同一页
    glm: {
        apiKey: 'https://docs.bigmodel.cn/cn/guide/start/quick-start',
        model: 'https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E6%96%87%E6%9C%AC%E8%BD%AC%E8%AF%AD%E9%9F%B3',
        voice: 'https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E6%96%87%E6%9C%AC%E8%BD%AC%E8%AF%AD%E9%9F%B3',
        endpoint: 'https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E6%96%87%E6%9C%AC%E8%BD%AC%E8%AF%AD%E9%9F%B3',
    },
    stepfun: {
        apiKey: 'https://platform.stepfun.com/docs/zh/step-plan/integrations/audio-api',
        model: 'https://platform.stepfun.com/docs/zh/api-reference/audio/create-audio',
        voice: 'https://platform.stepfun.com/docs/zh/guides/developer/tts',
        endpoint: 'https://platform.stepfun.com/docs/zh/api-reference/audio/create-audio',
    },
    volcengine: {
        apiKey: 'https://www.volcengine.com/docs/6561/196768',
        model: 'https://www.volcengine.com/docs/6561/1598757',
        voice: 'https://www.volcengine.com/docs/6561/1257544',
        endpoint: 'https://www.volcengine.com/docs/6561/1598757',
    },
    openai: {
        apiKey: 'https://platform.openai.com/docs/quickstart',
        model: 'https://developers.openai.com/api/docs/guides/text-to-speech',
        voice: 'https://developers.openai.com/api/docs/guides/text-to-speech',
        endpoint: 'https://developers.openai.com/api/docs/guides/text-to-speech',
    },
    'volcengine-agent': {
        apiKey: 'https://ark.volcengine.com/region:cn-beijing/docs/82379/2160841?lang=zh',
        model: 'https://docs.volcengine.com/docs/ark/agent-plan-personal-voice-model?lang=zh',
        voice: 'https://www.volcengine.com/docs/6561/1257544',
        endpoint: 'https://docs.volcengine.com/docs/ark/agent-plan-personal-voice-model?lang=zh',
    },
};

/** 提供免费试用的云端语音：火山引擎新用户有免费推理额度，可参考文档自行开通（覆盖的模型以控制台「开通管理」为准） */
export const CLOUD_TTS_FREE_TRIAL: Partial<Record<CloudTtsProvider, string>> = {
    volcengine: 'https://docs.volcengine.com/docs/ark/free-inference-quota?lang=zh',
};

/** 支持自然语言指令的语音（千问、阶跃星辰 StepAudio）使用的语气指令（中英文讲解通用） */
export const VOICE_STYLE_INSTRUCTION = '用年轻男性的声音讲题，自然、清晰，略带科技感，像面对面给同学讲解；语速适中，不要播音腔，不要模仿角色或夸张表演。';

/** 归一化的目标响度（LUFS），落在人声常用的 -16 ~ -14 LUFS 区间中间 */
export const TARGET_LOUDNESS_LUFS = -15;
/** 归一化后的峰值上限（dBFS），留出余量避免削波 */
export const PEAK_CEILING_DBFS = -1.5;

/**
 * 该语音是否按语气指令合成：千问；阶跃星辰的 StepAudio 模型（其他阶跃模型传入指令会报错）；
 * OpenAI 的 gpt-4o-mini-tts 等（tts-1 系列不支持指令）
 */
export function usesStyleInstruction(provider: CloudTtsProvider, model: string): boolean {
    return provider === 'qwen'
        || (provider === 'stepfun' && model.startsWith('stepaudio-'))
        || (provider === 'openai' && !model.startsWith('tts-'));
}

export function isTtsMode(value: unknown): value is TtsMode {
    return typeof value === 'string' && (TTS_MODES as readonly string[]).includes(value);
}

export function isCloudTtsProvider(value: unknown): value is CloudTtsProvider {
    return value !== 'browser' && isTtsMode(value);
}

/**
 * 默认的语音合成接口地址，按对应渠道的 Base URL 推算：
 * MiniMax 的语音接口与对话接口同在 /v1 下（https://api.minimax.cn/v1/t2a_v2）；
 * 百炼的语音接口在同一域名的 /api/v1 下（Token Plan 为 token-plan.cn-beijing.maas.aliyuncs.com）；
 * 智谱、阶跃星辰、OpenAI 的语音接口与对话接口同在 Base URL 下（/audio/speech）
 */
export function defaultTtsEndpoint(provider: CloudTtsProvider, vendor: VendorConfig | undefined): string {
    if (provider === 'volcengine') return VOLCENGINE_TTS_ENDPOINT;
    if (provider === 'volcengine-agent') return VOLCENGINE_AGENT_TTS_ENDPOINT;
    if (provider === 'openai') return `${(vendor?.baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '')}/audio/speech`;
    const { baseUrl } = resolveVendorConfig(provider, vendor);
    if (provider === 'minimax') return `${baseUrl.replace(/\/+$/, '')}/t2a_v2`;
    if (provider === 'glm' || provider === 'stepfun') return `${baseUrl.replace(/\/+$/, '')}/audio/speech`;
    try {
        return `${new URL(baseUrl).origin}/api/v1/services/audio/tts/SpeechSynthesizer`;
    } catch {
        return '';
    }
}
