/**
 * 云端语音接口：查询朗读方式、合成并缓存、按编号读取音频（含 Range 请求）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    errorItem: { findUnique: vi.fn() },
    session: { user: { email: 'user@example.com' }, expires: '2099-01-01' } as { user: { email: string }; expires: string } | null,
    config: {} as Record<string, unknown>,
    fetch: vi.fn(),
    encoded: [] as PcmAudio[],
}));

vi.mock('@/lib/prisma', () => ({ prisma: { user: mocks.user, errorItem: mocks.errorItem } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => mocks.config }));
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));
vi.mock('@/lib/tts/mp3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/tts/mp3')>();
    return {
        ...actual,
        // 记录编码前的音频，用于检查响度归一化
        encodeMp3: (audio: PcmAudio) => {
            mocks.encoded.push(audio);
            return actual.encodeMp3(audio);
        },
    };
});
vi.stubGlobal('fetch', mocks.fetch);

import { GET as getMode, POST as synthesize } from '@/app/api/tts/route';
import { GET as getAudio } from '@/app/api/tts/[id]/route';
import { POST as batch } from '@/app/api/tts/batch/route';
import { POST as status } from '@/app/api/tts/status/route';
import { listBackgroundTasks, resetBackgroundTasksForTest } from '@/lib/background-tasks';
import { measureLoudness } from '@/lib/tts/loudness';
import { looksLikeMp3 } from '@/lib/tts/mp3';
import type { PcmAudio } from '@/lib/tts/wav';

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-api-'));
const originalConfigDir = process.env.CONFIG_DIR;
process.env.CONFIG_DIR = configDir;

afterAll(() => {
    process.env.CONFIG_DIR = originalConfigDir;
    fs.rmSync(configDir, { recursive: true, force: true });
});

/** MiniMax 返回的 1 秒 440Hz 较小音量 PCM（十六进制） */
function miniMaxAudio(): string {
    const pcm = Buffer.alloc(24000 * 2);
    for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(1000 * Math.sin(2 * Math.PI * 440 * i / 24000)), i * 2);
    return pcm.toString('hex');
}

const post = (body: unknown) => synthesize(new Request('http://localhost/api/tts', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
}));
const postTo = (handler: (req: Request) => Promise<Response>, body: unknown) => handler(new Request('http://localhost/api/tts/x', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
}));
const audio = (id: string, headers: Record<string, string> = {}) =>
    getAudio(new Request(`http://localhost/api/tts/${id}`, { headers }), { params: Promise.resolve({ id }) });

beforeEach(() => {
    vi.clearAllMocks();
    mocks.encoded.length = 0;
    resetBackgroundTasksForTest();
    mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1', shortId: 'AbC234', questionText: '求解 x + 2 = 5' });
    mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
    mocks.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user' });
    mocks.config = { tts: { mode: 'minimax' }, minimax: { apiKey: 'mm-key' } };
    mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ data: { audio: miniMaxAudio() }, base_resp: { status_code: 0 } })));
});

describe('云端语音接口', () => {
    it('返回朗读方式：未设置或浏览器语音为 browser，MiniMax / 千问为 cloud', async () => {
        expect(await (await getMode()).json()).toEqual({ mode: 'cloud' });
        mocks.config = { tts: { mode: 'browser' } };
        expect(await (await getMode()).json()).toEqual({ mode: 'browser' });
        mocks.config = {};
        expect(await (await getMode()).json()).toEqual({ mode: 'browser' });
    });

    it('合成后返回编号和版本，音频为归一化到约 -15 LUFS 的 MP3；同样的文字只合成一次', async () => {
        const res = await post({ text: '第一步，先看条件。', language: 'zh' });
        expect(res.status).toBe(200);
        const { id, version } = await res.json();
        expect(id).toMatch(/^[a-f0-9]{64}$/);
        expect(version).toEqual(expect.any(Number));
        expect(mocks.encoded).toHaveLength(1);
        expect(mocks.encoded[0].sampleRate).toBe(24000);
        expect(measureLoudness(mocks.encoded[0])).toBeCloseTo(-15, 0);

        const file = await audio(id);
        expect(file.status).toBe(200);
        expect(file.headers.get('Content-Type')).toBe('audio/mpeg');
        expect(file.headers.get('Accept-Ranges')).toBe('bytes');
        expect(looksLikeMp3(Buffer.from(await file.arrayBuffer()))).toBe(true);

        expect(await (await post({ text: '第一步，先看条件。', language: 'zh' })).json()).toEqual({ id, version });
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    it('重新生成时忽略缓存再合成一次，编号不变', async () => {
        const first = await (await post({ text: '重新生成', language: 'zh' })).json();
        const second = await (await post({ text: '重新生成', language: 'zh', regenerate: true })).json();
        expect(second.id).toBe(first.id);
        expect(second.version).toBeGreaterThanOrEqual(first.version);
        expect(mocks.fetch).toHaveBeenCalledTimes(2);
    });

    it('换了音色重新合成', async () => {
        const first = await (await post({ text: '换音色', language: 'zh' })).json();
        mocks.config = { tts: { mode: 'minimax', minimax: { voice: 'other-voice' } }, minimax: { apiKey: 'mm-key' } };
        const second = await (await post({ text: '换音色', language: 'zh' })).json();
        expect(second.id).not.toBe(first.id);
        expect(mocks.fetch).toHaveBeenCalledTimes(2);
    });

    it('支持 Range 请求，超出范围返回 416', async () => {
        const { id } = await (await post({ text: '分段读取', language: 'zh' })).json();
        const full = Buffer.from(await (await audio(id)).arrayBuffer());

        const part = await audio(id, { Range: 'bytes=0-1' });
        expect(part.status).toBe(206);
        expect(part.headers.get('Content-Range')).toBe(`bytes 0-1/${full.length}`);
        expect(Buffer.from(await part.arrayBuffer())).toEqual(full.subarray(0, 2));

        const tail = await audio(id, { Range: 'bytes=-4' });
        expect(tail.headers.get('Content-Range')).toBe(`bytes ${full.length - 4}-${full.length - 1}/${full.length}`);
        expect((await audio(id, { Range: `bytes=${full.length}-` })).status).toBe(416);
    });

    it('浏览器语音、未配置 Key、文字无效时返回对应错误', async () => {
        mocks.config = { tts: { mode: 'browser' } };
        expect(await (await post({ text: '你好' })).json()).toMatchObject({ message: 'TTS_DISABLED' });

        mocks.config = { tts: { mode: 'qwen' } };
        const notConfigured = await post({ text: '你好' });
        expect(notConfigured.status).toBe(400);
        expect(await notConfigured.json()).toMatchObject({ message: 'TTS_NOT_CONFIGURED' });

        expect((await post({ text: '' })).status).toBe(400);
        expect((await post({ text: '长'.repeat(301) })).status).toBe(400);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it('服务商出错返回 502，原始报错只返回给管理员', async () => {
        mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ base_resp: { status_code: 2056, status_msg: '已达到 Token Plan 用量上限' } })));
        const res = await post({ text: '服务商出错' });
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body).toMatchObject({ message: 'TTS_PROVIDER_ERROR' });
        expect(body.details).toBeUndefined();

        mocks.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin' });
        expect(await (await post({ text: '服务商出错' })).json()).toMatchObject({
            message: 'TTS_PROVIDER_ERROR',
            details: 'MiniMax 2056: 已达到 Token Plan 用量上限',
        });
    });

    it('未登录不能使用；无效编号返回 404', async () => {
        mocks.session = null;
        expect((await getMode()).status).toBe(401);
        expect((await post({ text: '你好' })).status).toBe(401);
        expect((await audio('a'.repeat(64))).status).toBe(401);

        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        expect((await audio('../app-config')).status).toBe(404);
        expect((await audio('b'.repeat(64))).status).toBe(404);
    });
});

describe('整个动画的语音', () => {
    it('批量合成全部段落并登记后台任务（含进度和题目说明）；全部已有缓存时直接返回，不再登记', async () => {
        const res = await postTo(batch, { texts: ['批量一', '批量二'], language: 'zh', errorItemId: 'item-1' });
        expect(res.status).toBe(200);
        const { items } = await res.json();
        expect(items).toHaveLength(2);
        expect(mocks.fetch).toHaveBeenCalledTimes(2);

        const [task] = listBackgroundTasks('user-1');
        expect(task).toMatchObject({
            kind: 'tts_voice', status: 'succeeded', progress: { done: 2, total: 2 },
            link: '/error-items/item-1', subject: expect.stringContaining('AbC234'),
        });

        const again = await (await postTo(batch, { texts: ['批量一', '批量二'], language: 'zh' })).json();
        expect(again.items).toEqual(items);
        expect(mocks.fetch).toHaveBeenCalledTimes(2);
        expect(listBackgroundTasks('user-1')).toHaveLength(1);
    });

    it('只合成没有缓存的段落；重新生成时全部重新合成', async () => {
        await post({ text: '已有一段', language: 'zh' });
        await postTo(batch, { texts: ['已有一段', '新的一段'], language: 'zh' });
        expect(mocks.fetch).toHaveBeenCalledTimes(2);

        await postTo(batch, { texts: ['已有一段', '新的一段'], language: 'zh', regenerate: true });
        expect(mocks.fetch).toHaveBeenCalledTimes(4);
    });

    it('别人的错题不显示题目说明；失败时任务标记失败，管理员看到服务商报错', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'someone-else', shortId: 'Zz9999', questionText: '别人的题' });
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'admin' });
        mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ base_resp: { status_code: 2056, status_msg: '用量上限' } })));

        const res = await postTo(batch, { texts: ['失败的段落'], language: 'zh', errorItemId: 'item-x' });
        expect(res.status).toBe(502);
        expect(await res.json()).toMatchObject({ message: 'TTS_PROVIDER_ERROR', details: 'MiniMax 2056: 用量上限' });
        expect(listBackgroundTasks('user-1')[0]).toMatchObject({ kind: 'tts_voice', status: 'failed', subject: null, link: null });
    });

    it('浏览器语音或参数无效时返回错误', async () => {
        expect((await postTo(batch, { texts: [], language: 'zh' })).status).toBe(400);
        expect((await postTo(batch, { texts: Array(21).fill('段'), language: 'zh' })).status).toBe(400);
        mocks.config = { tts: { mode: 'browser' } };
        expect(await (await postTo(batch, { texts: ['你好'] })).json()).toMatchObject({ message: 'TTS_DISABLED' });
    });

    it('查询语音是否已全部合成，不调用服务商', async () => {
        expect(await (await postTo(status, { texts: ['查询一', '查询二'], language: 'zh' })).json()).toEqual({ ready: false });
        await postTo(batch, { texts: ['查询一', '查询二'], language: 'zh' });
        mocks.fetch.mockClear();
        expect(await (await postTo(status, { texts: ['查询一', '查询二'], language: 'zh' })).json()).toEqual({ ready: true });
        expect(await (await postTo(status, { texts: ['查询一'], language: 'en' })).json()).toEqual({ ready: false });
        expect(mocks.fetch).not.toHaveBeenCalled();

        mocks.config = { tts: { mode: 'browser' } };
        expect(await (await postTo(status, { texts: ['查询一'], language: 'zh' })).json()).toEqual({ ready: false });
        mocks.session = null;
        expect((await postTo(status, { texts: ['查询一'] })).status).toBe(401);
    });
});

