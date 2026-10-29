/**
 * 云端语音合成：MiniMax（T2A v2）与千问（百炼 Qwen-Audio-TTS），均返回单声道 PCM 采样。
 * API Key 复用「AI 设置」中对应国产大模型渠道的配置。
 */
import { resolveVendorConfig } from "@/lib/ai/vendor-presets";
import type { VendorConfig } from "@/lib/ai/vendor-presets";
import { CLOUD_TTS_DEFAULTS, QWEN_TTS_INSTRUCTION, defaultTtsEndpoint } from "./constants";
import type { CloudTtsProvider, CloudTtsSettings } from "./constants";
import { parseWav, pcm16ToFloat } from "./wav";
import type { PcmAudio } from "./wav";

const SAMPLE_RATE = 24000;
const REQUEST_TIMEOUT_MS = 90_000;

/** 合成失败：code 供前端区分未配置和服务商报错 */
export class TtsError extends Error {
    constructor(public code: 'TTS_NOT_CONFIGURED' | 'TTS_PROVIDER_ERROR', message: string) {
        super(message);
    }
}

export interface ResolvedTtsSettings {
    provider: CloudTtsProvider;
    apiKey: string;
    endpoint: string;
    model: string;
    voice: string;
}

/** 合并语音设置与渠道配置：模型、音色留空用默认值，接口地址留空按渠道 Base URL 推算 */
export function resolveTtsSettings(provider: CloudTtsProvider, settings: CloudTtsSettings | undefined, vendor: VendorConfig | undefined): ResolvedTtsSettings {
    const { apiKey } = resolveVendorConfig(provider, vendor);
    const defaults = CLOUD_TTS_DEFAULTS[provider];
    return {
        provider,
        apiKey,
        endpoint: settings?.endpoint?.trim() || defaultTtsEndpoint(provider, vendor),
        model: settings?.model?.trim() || defaults.model,
        voice: settings?.voice?.trim() || defaults.voice,
    };
}

async function postJson(url: string, apiKey: string, body: unknown): Promise<unknown> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        // 非 JSON 响应按文本报错
    }
    if (!res.ok) {
        const message = (data as { message?: string } | null)?.message ?? text.slice(0, 200);
        throw new TtsError('TTS_PROVIDER_ERROR', `HTTP ${res.status}: ${message}`);
    }
    return data;
}

interface MiniMaxResponse {
    data?: { audio?: string } | null;
    base_resp?: { status_code?: number; status_msg?: string };
}

async function synthesizeMiniMax(text: string, language: 'zh' | 'en', settings: ResolvedTtsSettings): Promise<PcmAudio> {
    const data = await postJson(settings.endpoint, settings.apiKey, {
        model: settings.model,
        text,
        stream: false,
        voice_setting: { voice_id: settings.voice, speed: 1, vol: 1, pitch: 0 },
        audio_setting: { format: 'pcm', sample_rate: SAMPLE_RATE, channel: 1 },
        language_boost: language === 'en' ? 'English' : 'Chinese',
        output_format: 'hex',
    }) as MiniMaxResponse;
    const status = data?.base_resp?.status_code;
    if (status !== 0 || !data?.data?.audio) {
        throw new TtsError('TTS_PROVIDER_ERROR', `MiniMax ${status ?? 'error'}: ${data?.base_resp?.status_msg ?? 'no audio'}`);
    }
    return { sampleRate: SAMPLE_RATE, samples: pcm16ToFloat(Buffer.from(data.data.audio, 'hex')) };
}

interface QwenResponse {
    output?: { audio?: { url?: string; data?: string } };
    code?: string;
    message?: string;
}

async function synthesizeQwen(text: string, settings: ResolvedTtsSettings): Promise<PcmAudio> {
    const data = await postJson(settings.endpoint, settings.apiKey, {
        model: settings.model,
        input: { text, voice: settings.voice, instruction: QWEN_TTS_INSTRUCTION, format: 'wav', sample_rate: SAMPLE_RATE },
    }) as QwenResponse;
    const audio = data?.output?.audio;
    if (audio?.data) return parseWav(Buffer.from(audio.data, 'base64'));
    if (!audio?.url) {
        throw new TtsError('TTS_PROVIDER_ERROR', `Qwen ${data?.code ?? 'error'}: ${data?.message ?? 'no audio'}`);
    }
    // 非流式只返回音频地址（24 小时有效），立即下载
    const res = await fetch(audio.url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new TtsError('TTS_PROVIDER_ERROR', `Qwen audio download HTTP ${res.status}`);
    return parseWav(Buffer.from(await res.arrayBuffer()));
}

export async function synthesizeWithProvider(text: string, language: 'zh' | 'en', settings: ResolvedTtsSettings): Promise<PcmAudio> {
    if (!settings.apiKey) {
        throw new TtsError('TTS_NOT_CONFIGURED', `${settings.provider} API key is not configured`);
    }
    return settings.provider === 'minimax'
        ? synthesizeMiniMax(text, language, settings)
        : synthesizeQwen(text, settings);
}
