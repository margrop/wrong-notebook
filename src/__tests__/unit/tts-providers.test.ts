/**
 * 云端语音合成：MiniMax 与千问的请求格式、默认设置、接口地址推算和错误处理
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_TTS_DEFAULTS, CLOUD_TTS_DOCS, TTS_MODES, defaultTtsEndpoint, getTtsChannelConfig } from '@/lib/tts/constants';
import { TtsError, resolveTtsSettings, splitJsonObjects, synthesizeWithProvider } from '@/lib/tts/providers';
import { encodeWav } from '@/lib/tts/wav';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const requestBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

beforeEach(() => fetchMock.mockReset());

describe('语音设置', () => {
    it('每个云端语音的 API Key、模型、音色、接口地址都附有官方文档链接', () => {
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

describe('智谱 GLM-TTS 语音合成', () => {
    const settings = resolveTtsSettings('glm', undefined, { apiKey: 'glm-key' });
    const wav = encodeWav({ sampleRate: 24000, samples: new Float32Array([0.5, -0.5, 0]) });

    it('接口与对话接口同在 Base URL 下，默认音色小陈，直接返回 WAV', async () => {
        expect(settings).toMatchObject({ endpoint: 'https://open.bigmodel.cn/api/paas/v4/audio/speech', model: 'glm-tts', voice: 'xiaochen' });
        fetchMock.mockResolvedValue(new Response(new Uint8Array(wav), { headers: { 'Content-Type': 'audio/wav' } }));

        const audio = await synthesizeWithProvider('第一步', 'zh', settings);
        expect(audio.sampleRate).toBe(24000);
        expect(audio.samples[0]).toBeCloseTo(0.5, 3);
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer glm-key');
        expect(requestBody()).toEqual({
            model: 'glm-tts', input: '第一步', voice: 'xiaochen', response_format: 'wav', speed: 1, volume: 1, watermark_enabled: false,
        });
    });

    it('错误响应带上服务商的错误码和说明；返回 JSON 而不是音频时报错', async () => {
        fetchMock.mockResolvedValueOnce(json({ error: { code: '1113', message: '余额不足' } }, 429));
        await expect(synthesizeWithProvider('你好', 'zh', settings)).rejects.toMatchObject({ code: 'TTS_PROVIDER_ERROR', message: 'HTTP 429: 1113: 余额不足' });
        fetchMock.mockResolvedValueOnce(json({ error: { message: 'unexpected' } }));
        await expect(synthesizeWithProvider('你好', 'zh', settings)).rejects.toMatchObject({ message: expect.stringContaining('unexpected') });
    });
});

describe('阶跃星辰语音合成', () => {
    const wav = encodeWav({ sampleRate: 24000, samples: new Float32Array([0.25, 0]) });

    it('接口与对话接口同在 Base URL 下，StepAudio 模型带语气指令，返回 WAV', async () => {
        const settings = resolveTtsSettings('stepfun', undefined, { apiKey: 'step-key' });
        expect(settings).toMatchObject({ endpoint: 'https://api.stepfun.com/step_plan/v1/audio/speech', model: 'stepaudio-2.5-tts', voice: 'qingniandaxuesheng' });
        fetchMock.mockResolvedValue(new Response(new Uint8Array(wav), { headers: { 'Content-Type': 'audio/wav' } }));

        const audio = await synthesizeWithProvider('第一步', 'zh', settings);
        expect(audio.samples[0]).toBeCloseTo(0.25, 3);
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer step-key');
        expect(requestBody()).toMatchObject({
            model: 'stepaudio-2.5-tts', input: '第一步', voice: 'qingniandaxuesheng', response_format: 'wav', sample_rate: 24000,
            instruction: expect.stringContaining('不要播音腔'),
        });
    });

    it('按量付费地址同样推算；其他模型不传指令（传入会报错）', async () => {
        const settings = resolveTtsSettings('stepfun', { model: 'step-tts-2' }, { apiKey: 'k', baseUrl: 'https://api.stepfun.com/v1' });
        expect(settings.endpoint).toBe('https://api.stepfun.com/v1/audio/speech');
        fetchMock.mockResolvedValue(new Response(new Uint8Array(wav), { headers: { 'Content-Type': 'audio/wav' } }));
        await synthesizeWithProvider('第一步', 'zh', settings);
        expect(requestBody()).not.toHaveProperty('instruction');
    });

    it('错误响应带上服务商说明', async () => {
        fetchMock.mockResolvedValueOnce(json({ error: { message: 'voice not supported', type: 'invalid_request_error' } }, 400));
        const settings = resolveTtsSettings('stepfun', undefined, { apiKey: 'k' });
        await expect(synthesizeWithProvider('你好', 'zh', settings)).rejects.toMatchObject({ message: expect.stringContaining('voice not supported') });
    });
});

describe('火山引擎豆包语音合成', () => {
    const pcm = (values: number[]) => {
        const buffer = Buffer.alloc(values.length * 2);
        values.forEach((value, i) => buffer.writeInt16LE(value, i * 2));
        return buffer.toString('base64');
    };
    const stream = (...chunks: object[]) => new Response(chunks.map((chunk) => JSON.stringify(chunk)).join(''), { headers: { 'Content-Type': 'application/json' } });

    it('使用语音设置中单独的 Key，不复用火山方舟渠道的 Key；默认资源 ID 与音色', () => {
        const settings = resolveTtsSettings('volcengine', { apiKey: ' speech-key ' }, { apiKey: 'ark-key' });
        expect(settings).toMatchObject({
            apiKey: 'speech-key',
            endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
            model: 'seed-tts-2.0',
            voice: 'zh_male_yangguangqingnian_uranus_bigtts',
        });
        expect(resolveTtsSettings('volcengine', undefined, { apiKey: 'ark-key' }).apiKey).toBe('');
    });

    it('按 API Key 与资源 ID 鉴权，拼接流式返回的 PCM 分片', async () => {
        fetchMock.mockResolvedValue(stream(
            { code: 0, message: '', data: pcm([16384]) },
            { code: 0, message: '', data: pcm([-16384]), sentence: { text: '第一步{测试}' } },
            { code: 20000000, message: 'ok', data: null },
        ));
        const settings = resolveTtsSettings('volcengine', { apiKey: 'speech-key' }, undefined);
        const audio = await synthesizeWithProvider('第一步', 'zh', settings);
        expect(Array.from(audio.samples)).toEqual([0.5, -0.5]);

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://openspeech.bytedance.com/api/v3/tts/unidirectional');
        expect(init.headers).toMatchObject({ 'X-Api-Key': 'speech-key', 'X-Api-Resource-Id': 'seed-tts-2.0', 'X-Api-Request-Id': expect.any(String) });
        expect(init.headers).not.toHaveProperty('Authorization');
        expect(requestBody()).toEqual({
            user: { uid: 'wrong-notebook' },
            req_params: { text: '第一步', speaker: 'zh_male_yangguangqingnian_uranus_bigtts', audio_params: { format: 'pcm', sample_rate: 24000 } },
        });
    });

    it('流中的错误码、HTTP 错误和没有音频时报服务商错误', async () => {
        const settings = resolveTtsSettings('volcengine', { apiKey: 'k' }, undefined);
        fetchMock.mockResolvedValueOnce(stream({ code: 45000000, message: 'speaker permission denied', data: null }));
        await expect(synthesizeWithProvider('你好', 'zh', settings)).rejects.toMatchObject({ message: 'Volcengine: 45000000: speaker permission denied' });
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'invalid api key' }), { status: 401 }));
        await expect(synthesizeWithProvider('你好', 'zh', settings)).rejects.toMatchObject({ message: expect.stringContaining('HTTP 401') });
        fetchMock.mockResolvedValueOnce(stream({ code: 20000000, message: 'ok', data: null }));
        await expect(synthesizeWithProvider('你好', 'zh', settings)).rejects.toMatchObject({ message: 'Volcengine: no audio' });
        await expect(synthesizeWithProvider('你好', 'zh', resolveTtsSettings('volcengine', undefined, { apiKey: 'ark' }))).rejects.toMatchObject({ code: 'TTS_NOT_CONFIGURED' });
    });

    it('拆分首尾相连或换行分隔的 JSON，忽略字符串中的括号和转义引号', () => {
        expect(splitJsonObjects('{"a":1}{"b":"x}{\\"y"}\n{"c":{"d":2}}')).toEqual([{ a: 1 }, { b: 'x}{"y' }, { c: { d: 2 } }]);
        expect(splitJsonObjects('')).toEqual([]);
    });
});

describe('火山引擎 Agent Plan 语音合成', () => {
    it('与 Agent Plan 渠道共用专属 Key，请求套餐的豆包语音地址', async () => {
        const settings = resolveTtsSettings('volcengine-agent', { apiKey: 'ignored' }, { apiKey: 'agent-plan-key' });
        expect(settings).toMatchObject({
            apiKey: 'agent-plan-key',
            endpoint: 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional',
            model: 'seed-tts-2.0',
            voice: 'zh_male_yangguangqingnian_uranus_bigtts',
        });
        const chunk = Buffer.alloc(2);
        chunk.writeInt16LE(8192, 0);
        fetchMock.mockResolvedValue(new Response(`${JSON.stringify({ code: 0, data: chunk.toString('base64') })}\n${JSON.stringify({ code: 20000000, message: 'ok' })}`));

        const audio = await synthesizeWithProvider('第一步', 'zh', settings);
        expect(Array.from(audio.samples)).toEqual([0.25]);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional');
        expect(init.headers).toMatchObject({ 'X-Api-Key': 'agent-plan-key', 'X-Api-Resource-Id': 'seed-tts-2.0' });
    });
});

describe('OpenAI 语音合成', () => {
    const config = {
        openai: {
            instances: [
                { id: 'a', name: 'A', apiKey: 'key-a', baseUrl: 'https://proxy.example.com/v1/', model: 'm' },
                { id: 'b', name: 'B', apiKey: 'key-b', baseUrl: 'https://api.openai.com/v1', model: 'm' },
            ],
            activeInstanceId: 'a',
        },
        glm: { apiKey: 'glm-key' },
    };

    it('留空 Key 时使用当前激活的 OpenAI 实例的 Key 和 Base URL；单独填写的 Key 优先', () => {
        expect(getTtsChannelConfig(config, 'openai')).toEqual({ apiKey: 'key-a', baseUrl: 'https://proxy.example.com/v1/' });
        expect(getTtsChannelConfig(config, 'glm')).toEqual({ apiKey: 'glm-key' });
        expect(getTtsChannelConfig({}, 'openai')).toBeUndefined();

        const shared = resolveTtsSettings('openai', undefined, getTtsChannelConfig(config, 'openai'));
        expect(shared).toMatchObject({ apiKey: 'key-a', endpoint: 'https://proxy.example.com/v1/audio/speech', model: 'gpt-4o-mini-tts', voice: 'cedar' });
        expect(resolveTtsSettings('openai', { apiKey: 'own-key' }, getTtsChannelConfig(config, 'openai')).apiKey).toBe('own-key');
        expect(resolveTtsSettings('openai', { apiKey: 'own-key' }, undefined)).toMatchObject({ endpoint: 'https://api.openai.com/v1/audio/speech' });
    });

    it('请求 PCM 并带语气指令，解码 24kHz 16 位 PCM', async () => {
        const pcm = Buffer.alloc(4);
        pcm.writeInt16LE(16384, 0);
        pcm.writeInt16LE(-8192, 2);
        fetchMock.mockResolvedValue(new Response(new Uint8Array(pcm), { headers: { 'Content-Type': 'audio/pcm' } }));
        const settings = resolveTtsSettings('openai', { apiKey: 'own-key' }, undefined);

        const audio = await synthesizeWithProvider('第一步', 'zh', settings);
        expect(audio.sampleRate).toBe(24000);
        expect(Array.from(audio.samples)).toEqual([0.5, -0.25]);
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer own-key');
        expect(requestBody()).toMatchObject({
            model: 'gpt-4o-mini-tts', input: '第一步', voice: 'cedar', response_format: 'pcm', instructions: expect.stringContaining('不要播音腔'),
        });
    });

    it('tts-1 系列不传指令；没有 Key 时报未配置；错误带上服务商说明', async () => {
        fetchMock.mockResolvedValue(new Response(new Uint8Array(Buffer.alloc(2)), { headers: { 'Content-Type': 'audio/pcm' } }));
        await synthesizeWithProvider('你好', 'zh', resolveTtsSettings('openai', { apiKey: 'k', model: 'tts-1-hd' }, undefined));
        expect(requestBody()).not.toHaveProperty('instructions');

        await expect(synthesizeWithProvider('你好', 'zh', resolveTtsSettings('openai', undefined, undefined))).rejects.toMatchObject({ code: 'TTS_NOT_CONFIGURED' });

        fetchMock.mockResolvedValueOnce(json({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }, 401));
        await expect(synthesizeWithProvider('你好', 'zh', resolveTtsSettings('openai', { apiKey: 'bad' }, undefined)))
            .rejects.toMatchObject({ message: 'HTTP 401: invalid_api_key: Incorrect API key provided' });
    });
});
