/**
 * 云端语音合成：MiniMax 与千问的请求格式、默认设置、接口地址推算和错误处理
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_TTS_DEFAULTS, CLOUD_TTS_DOCS, TTS_MODES, defaultTtsEndpoint } from '@/lib/tts/constants';
import { TtsError, resolveTtsSettings, synthesizeWithProvider } from '@/lib/tts/providers';
import { encodeWav } from '@/lib/tts/wav';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const requestBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

beforeEach(() => fetchMock.mockReset());

describe('语音设置', () => {
    it('每个云端语音的模型、音色、接口地址都附有官方文档链接', () => {
        for (const mode of TTS_MODES.filter((value) => value !== 'browser')) {
            const docs = CLOUD_TTS_DOCS[mode as keyof typeof CLOUD_TTS_DOCS];
            expect(docs, mode).toBeDefined();
            for (const url of Object.values(docs)) expect(url, mode).toMatch(/^https:\/\//);
        }
    });

    it('模型、音色留空用默认值，接口地址按渠道 Base URL 推算', () => {
        expect(resolveTtsSettings('minimax', undefined, { apiKey: 'k' })).toEqual({
            provider: 'minimax', apiKey: 'k', endpoint: 'https://api.minimax.cn/v1/t2a_v2', ...CLOUD_TTS_DEFAULTS.minimax,
        });
        expect(resolveTtsSettings('qwen', { voice: ' my-voice ' }, { apiKey: 'sk-sp-1' })).toMatchObject({
            endpoint: 'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
            model: CLOUD_TTS_DEFAULTS.qwen.model,
            voice: 'my-voice',
        });
        expect(resolveTtsSettings('qwen', { endpoint: 'https://x.example.com/tts' }, undefined).endpoint).toBe('https://x.example.com/tts');
    });

    it('按自定义 Base URL 推算接口地址', () => {
        expect(defaultTtsEndpoint('minimax', { baseUrl: 'https://api.minimax.io/v1/' })).toBe('https://api.minimax.io/v1/t2a_v2');
        expect(defaultTtsEndpoint('qwen', { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }))
            .toBe('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
        expect(defaultTtsEndpoint('qwen', { baseUrl: 'not a url' })).toBe('');
    });

    it('没有 API Key 时报未配置，不发请求', async () => {
        const settings = resolveTtsSettings('minimax', undefined, undefined);
        await expect(synthesizeWithProvider('你好', 'zh', settings)).rejects.toMatchObject({ code: 'TTS_NOT_CONFIGURED' });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('MiniMax 语音合成', () => {
    const settings = resolveTtsSettings('minimax', undefined, { apiKey: 'mm-key' });

    it('请求 24kHz PCM，解码返回的十六进制音频', async () => {
        const pcm = Buffer.alloc(4);
        pcm.writeInt16LE(16384, 0);
        pcm.writeInt16LE(-16384, 2);
        fetchMock.mockResolvedValue(json({ data: { audio: pcm.toString('hex') }, base_resp: { status_code: 0 } }));

        const audio = await synthesizeWithProvider('第一步', 'zh', settings);
        expect(audio.sampleRate).toBe(24000);
        expect(Array.from(audio.samples)).toEqual([0.5, -0.5]);

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.minimax.cn/v1/t2a_v2');
        expect(init.headers.Authorization).toBe('Bearer mm-key');
        expect(requestBody()).toMatchObject({
            model: 'speech-2.8-hd',
            text: '第一步',
            stream: false,
            voice_setting: { voice_id: 'male-qn-jingying' },
            audio_setting: { format: 'pcm', sample_rate: 24000, channel: 1 },
            language_boost: 'Chinese',
        });
    });

    it('英文讲解提示英文；业务错误码报服务商错误', async () => {
        fetchMock.mockResolvedValue(json({ base_resp: { status_code: 1004, status_msg: 'auth failed' } }));
        const error = await synthesizeWithProvider('Step one', 'en', settings).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(TtsError);
        expect(error).toMatchObject({ code: 'TTS_PROVIDER_ERROR', message: expect.stringContaining('auth failed') });
        expect(requestBody().language_boost).toBe('English');
    });

    it('HTTP 错误报服务商错误', async () => {
        fetchMock.mockResolvedValue(new Response('bad gateway', { status: 502 }));
        await expect(synthesizeWithProvider('你好', 'zh', settings)).rejects.toMatchObject({ code: 'TTS_PROVIDER_ERROR', message: expect.stringContaining('502') });
    });
});

describe('千问语音合成', () => {
    const settings = resolveTtsSettings('qwen', undefined, { apiKey: 'sk-sp-key' });
    const wav = encodeWav({ sampleRate: 24000, samples: new Float32Array([0.25, -0.25]) });

    it('带音色和语气指令请求，下载返回地址中的 WAV', async () => {
        fetchMock
            .mockResolvedValueOnce(json({ output: { audio: { url: 'https://oss.example.com/a.wav' } } }))
            .mockResolvedValueOnce(new Response(new Uint8Array(wav)));

        const audio = await synthesizeWithProvider('第一步', 'zh', settings);
        expect(audio.samples.length).toBe(2);
        expect(audio.samples[0]).toBeCloseTo(0.25, 3);
        expect(fetchMock.mock.calls[0][0]).toBe('https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-sp-key');
        expect(requestBody()).toMatchObject({
            model: 'qwen-audio-3.0-tts-plus',
            input: { text: '第一步', voice: 'longanlufeng', format: 'wav', sample_rate: 24000, instruction: expect.stringContaining('不要播音腔') },
        });
        expect(fetchMock.mock.calls[1][0]).toBe('https://oss.example.com/a.wav');
    });

    it('直接返回 Base64 音频时不再下载', async () => {
        fetchMock.mockResolvedValueOnce(json({ output: { audio: { data: wav.toString('base64') } } }));
        const audio = await synthesizeWithProvider('你好', 'zh', settings);
        expect(audio.samples.length).toBe(2);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('错误响应带上服务商的错误信息', async () => {
        fetchMock.mockResolvedValueOnce(json({ code: 'InvalidParameter', message: 'voice not found' }, 400));
        await expect(synthesizeWithProvider('你好', 'zh', settings)).rejects.toMatchObject({ code: 'TTS_PROVIDER_ERROR', message: expect.stringContaining('voice not found') });
        fetchMock.mockResolvedValueOnce(json({ output: {} }));
        await expect(synthesizeWithProvider('你好', 'zh', settings)).rejects.toMatchObject({ code: 'TTS_PROVIDER_ERROR' });
        fetchMock
            .mockResolvedValueOnce(json({ output: { audio: { url: 'https://oss.example.com/a.wav' } } }))
            .mockResolvedValueOnce(new Response('gone', { status: 403 }));
        await expect(synthesizeWithProvider('你好', 'zh', settings)).rejects.toMatchObject({ message: expect.stringContaining('403') });
    });
});
