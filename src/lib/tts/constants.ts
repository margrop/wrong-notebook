/**
 * 动画语音讲解的朗读方式与云端语音合成（TTS）的默认设置。
 * 本文件不依赖 Node 模块，前端设置界面也会引用。
 */
import { resolveVendorConfig } from "@/lib/ai/vendor-presets";
import type { VendorConfig } from "@/lib/ai/vendor-presets";

/** browser：浏览器本地语音（Web Speech API）；minimax / qwen：服务端调用云端语音合成 */
export const TTS_MODES = ['browser', 'minimax', 'qwen'] as const;
export type TtsMode = typeof TTS_MODES[number];
export type CloudTtsProvider = Exclude<TtsMode, 'browser'>;

export interface CloudTtsSettings {
    model?: string;
    voice?: string;
    /** 完整的语音合成接口地址；留空时按对应渠道的 Base URL 推算 */
    endpoint?: string;
}

export interface TtsConfig {
    mode?: TtsMode;
    minimax?: CloudTtsSettings;
    qwen?: CloudTtsSettings;
}

/**
 * 默认音色：年轻男性，自然、清晰、略带科技感，不用播音腔、不模仿角色。
 * MiniMax 用系统音色「精英青年」；千问用 Qwen-Audio-TTS 的男声「龙安鲁风」（25 岁，明亮开朗），再用指令约束语气
 */
export const CLOUD_TTS_DEFAULTS: Record<CloudTtsProvider, Required<Omit<CloudTtsSettings, 'endpoint'>>> = {
    minimax: { model: 'speech-2.8-hd', voice: 'male-qn-jingying' },
    qwen: { model: 'qwen-audio-3.0-tts-plus', voice: 'longanlufeng' },
};

/** 千问语音的语气指令（中英文讲解通用） */
export const QWEN_TTS_INSTRUCTION = '用年轻男性的声音讲题，自然、清晰，略带科技感，像面对面给同学讲解；语速适中，不要播音腔，不要模仿角色或夸张表演。';

/** 归一化的目标响度（LUFS），落在人声常用的 -16 ~ -14 LUFS 区间中间 */
export const TARGET_LOUDNESS_LUFS = -15;
/** 归一化后的峰值上限（dBFS），留出余量避免削波 */
export const PEAK_CEILING_DBFS = -1.5;

export function isTtsMode(value: unknown): value is TtsMode {
    return typeof value === 'string' && (TTS_MODES as readonly string[]).includes(value);
}

export function isCloudTtsProvider(value: unknown): value is CloudTtsProvider {
    return value === 'minimax' || value === 'qwen';
}

/**
 * 默认的语音合成接口地址，按对应渠道的 Base URL 推算：
 * MiniMax 的语音接口与对话接口同在 /v1 下（https://api.minimax.cn/v1/t2a_v2）；
 * 百炼的语音接口在同一域名的 /api/v1 下（Token Plan 为 token-plan.cn-beijing.maas.aliyuncs.com）
 */
export function defaultTtsEndpoint(provider: CloudTtsProvider, vendor: VendorConfig | undefined): string {
    const { baseUrl } = resolveVendorConfig(provider, vendor);
    if (provider === 'minimax') return `${baseUrl.replace(/\/+$/, '')}/t2a_v2`;
    try {
        return `${new URL(baseUrl).origin}/api/v1/services/audio/tts/SpeechSynthesizer`;
    } catch {
        return '';
    }
}
