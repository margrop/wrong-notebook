// @vitest-environment node
/**
 * 外发队列（真实 SQLite + 模拟 fetch）：批次符合协议 v1 且不含错误原文；成功后标记或删除；
 * 发送条件（6 小时 / 100 条 / 重启后按 lastFlushAt 续算）；退避、降频与 410 停发；instance_alive 每天一条
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, TelemetryConfig } from '@/lib/config/types';

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    config: {} as Partial<AppConfig>,
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('@/lib/config', () => ({
    getAppConfig: () => mocks.config,
    updateAppConfig: (patch: Partial<AppConfig>) => {
        mocks.config = { ...mocks.config, ...patch, telemetry: { ...mocks.config.telemetry, ...patch.telemetry } };
        return mocks.config;
    },
}));

import { getAppVersion } from '@/lib/app-version';
import { envelopeSchema, validateItems } from '@/lib/telemetry/ingest-contract';
import { DEFAULT_FLUSH_INTERVAL_MS, flushOutbox, getOutboxRuntime, resetOutboxRuntime } from '@/lib/telemetry/outbox';
import { clearTelemetry, resetErrorDedupe, writeTelemetryError } from '@/lib/telemetry/server';
import { getTelemetryState } from '@/lib/telemetry/state';

let database: PrismaClient;
let directory: string;
const NOW = new Date('2026-11-05T12:00:00Z');
const HOUR = 3_600_000;

function configure(telemetry: TelemetryConfig, eula = 'v1') {
    mocks.config = {
        aiProvider: 'gemini', gemini: { apiKey: 'k' },
        eula: { acceptedVersion: eula },
        telemetry: { forwarding: true, recording: false, errors: true, endpoint: 'https://collector.test/api/v1/ingest', ...telemetry },
    };
}

function okFetch(body: object = { accepted: 1, rejected: 0, minIntervalSec: 0 }) {
    return vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => Response.json(body));
}

const sentBody = (fetchMock: ReturnType<typeof okFetch>, call = 0) => JSON.parse(String(fetchMock.mock.calls[call][1]?.body));

async function addEvents(count: number, local = false, createdAt = new Date(NOW.getTime() - HOUR)) {
    await database.telemetryEvent.createMany({ data: Array.from({ length: count }, () => ({
        name: 'page_viewed', payload: '{"page":"stats"}', version: getAppVersion(), local, createdAt,
    })) });
}

beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-outbox-test-'));
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } } });
    mocks.prisma = database;
}, 120000);

beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('WN_PLATFORM', 'fnos');
    resetOutboxRuntime();
    resetErrorDedupe();
    await clearTelemetry();
    configure({});
});

afterAll(async () => {
    vi.unstubAllEnvs();
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('批次内容', () => {
    it('首次发送：先写当天 instance_alive，批次通过收集服务契约且不含错误原文', async () => {
        configure({ recording: true });
        await addEvents(2, true);
        await writeTelemetryError({ kind: 'client', scope: '[GlobalError]', name: 'TypeError', message: 'secret a@b.com', stack: 'TypeError: x\n    at f (/a.js:1:2)', path: '/error-items/abc' }, getTelemetryState());
        const fetchMock = okFetch();

        const result = await flushOutbox({ now: NOW, fetchImpl: fetchMock });

        expect(result).toMatchObject({ status: 'sent', sent: 4 });
        expect(fetchMock).toHaveBeenCalledWith('https://collector.test/api/v1/ingest', expect.objectContaining({ method: 'POST' }));
        const init = fetchMock.mock.calls[0][1]!;
        expect(new Headers(init.headers).get('User-Agent')).toMatch(/^wrong-notebook\//);
        expect(new Headers(init.headers).has('Origin')).toBe(false);
        const body = sentBody(fetchMock);
        const envelope = envelopeSchema.parse(body);
        expect(validateItems(envelope.items, NOW)).toMatchObject({ rejected: 0 });
        expect(body.items).toContainEqual({ t: 'event', day: '2026-11-05', name: 'instance_alive', payload: { platform: 'fnos', aiConfigured: true } });
        const raw = JSON.stringify(body);
        expect(raw).not.toMatch(/secret|a@b\.com|error-items|at f/);
        // 本地记录开启：标记为已发并保留
        expect(await database.telemetryEvent.count({ where: { forwardedAt: null } })).toBe(0);
        expect(await database.telemetryError.findFirstOrThrow()).toMatchObject({ forwardedAt: NOW, message: 'secret <email>' });
        expect(mocks.config.telemetry?.lastFlushAt).toBe(NOW.toISOString());
    });

    it('只为外发保存的记录发送成功后删除；失败时保留并退避', async () => {
        await addEvents(3);
        const failing = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
        expect(await flushOutbox({ now: NOW, fetchImpl: failing })).toMatchObject({ status: 'failed' });
        expect(await database.telemetryEvent.count()).toBe(4);
        expect(getOutboxRuntime().lastAttempt).toMatchObject({ status: 'failed' });
        // 退避期间不再尝试
        expect(await flushOutbox({ now: new Date(NOW.getTime() + 60_000), force: true, fetchImpl: okFetch() })).toMatchObject({ status: 'backoff' });

        const fetchMock = okFetch();
        expect(await flushOutbox({ now: new Date(NOW.getTime() + HOUR), fetchImpl: fetchMock })).toMatchObject({ status: 'sent', sent: 4 });
        expect(await database.telemetryEvent.count()).toBe(0);
    });

    it('同一批只含一个版本（升级前的旧记录先发），每批最多 100 条', async () => {
        await database.telemetryEvent.create({ data: { name: 'app_opened', payload: '{"client":"pwa"}', version: '2000.1.1', local: false, createdAt: new Date(NOW.getTime() - 2 * HOUR) } });
        await addEvents(120);
        const fetchMock = okFetch();
        await flushOutbox({ now: NOW, fetchImpl: fetchMock });
        expect(sentBody(fetchMock)).toMatchObject({ version: '2000.1.1', items: [expect.objectContaining({ name: 'app_opened' })] });
        await flushOutbox({ now: NOW, force: true, fetchImpl: fetchMock });
        const body = sentBody(fetchMock, 1);
        expect(body.items).toHaveLength(100);
        expect(body.version).toBe(getAppVersion());
    });

    it('7 天前的待发记录不再发送', async () => {
        await addEvents(1, false, new Date(NOW.getTime() - 8 * 24 * HOUR));
        mocks.config.telemetry!.lastFlushAt = NOW.toISOString();
        const fetchMock = okFetch();
        expect(await flushOutbox({ now: NOW, force: true, fetchImpl: fetchMock })).toMatchObject({ status: 'empty' });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('发送条件', () => {
    it('不满 6 小时且不满 100 条时不发；满 6 小时或满 100 条时发送；重启后按 lastFlushAt 续算', async () => {
        configure({ lastFlushAt: new Date(NOW.getTime() - 5 * HOUR).toISOString() });
        await addEvents(10);
        const fetchMock = okFetch();
        expect(await flushOutbox({ now: NOW, fetchImpl: fetchMock })).toMatchObject({ status: 'not-due' });

        // 模拟重启：进程内状态清零，仍按配置中的 lastFlushAt 判断
        resetOutboxRuntime();
        expect(await flushOutbox({ now: new Date(NOW.getTime() + 30 * 60_000), fetchImpl: fetchMock })).toMatchObject({ status: 'not-due' });
        expect(await flushOutbox({ now: new Date(NOW.getTime() + HOUR), fetchImpl: fetchMock })).toMatchObject({ status: 'sent' });

        await addEvents(100);
        expect(await flushOutbox({ now: new Date(NOW.getTime() + HOUR + 60_000), fetchImpl: fetchMock })).toMatchObject({ status: 'sent', sent: 100 });
    });

    it('外发未生效时不发：开关关闭、从未同意、协议待重新同意、环境变量禁用', async () => {
        await addEvents(1);
        const fetchMock = okFetch();
        configure({ forwarding: false });
        expect((await flushOutbox({ now: NOW, fetchImpl: fetchMock })).status).toBe('disabled');
        configure({}, 'v0');
        expect((await flushOutbox({ now: NOW, fetchImpl: fetchMock })).status).toBe('disabled');
        mocks.config.eula = {};
        expect((await flushOutbox({ now: NOW, fetchImpl: fetchMock })).status).toBe('disabled');
        configure({});
        vi.stubEnv('TELEMETRY_DISABLED', 'true');
        expect((await flushOutbox({ now: NOW, fetchImpl: fetchMock })).status).toBe('disabled');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('instance_alive 每天只写一条', async () => {
        const fetchMock = okFetch();
        await flushOutbox({ now: NOW, fetchImpl: fetchMock });
        await flushOutbox({ now: new Date(NOW.getTime() + 7 * HOUR), force: true, fetchImpl: fetchMock });
        const alive = fetchMock.mock.calls.flatMap((_, i) => sentBody(fetchMock, i).items).filter((item: { name?: string }) => item.name === 'instance_alive');
        expect(alive).toHaveLength(1);
        await flushOutbox({ now: new Date(NOW.getTime() + 24 * HOUR), force: true, fetchImpl: fetchMock });
        expect(sentBody(fetchMock, fetchMock.mock.calls.length - 1).items.map((item: { name: string }) => item.name)).toContain('instance_alive');
    });
});

describe('服务端控制', () => {
    it('retryAfterSec 推迟下一轮；minIntervalSec 只能把间隔调大', async () => {
        await addEvents(1);
        await flushOutbox({ now: NOW, fetchImpl: okFetch({ accepted: 0, rejected: 2, retryAfterSec: 3600, minIntervalSec: 43200 }) });
        expect(getOutboxRuntime()).toMatchObject({ intervalMs: 12 * HOUR, nextAllowedAt: NOW.getTime() + HOUR });
        expect((await flushOutbox({ now: new Date(NOW.getTime() + 30 * 60_000), force: true, fetchImpl: okFetch() })).status).toBe('backoff');

        await addEvents(1);
        await flushOutbox({ now: new Date(NOW.getTime() + 2 * HOUR), force: true, fetchImpl: okFetch({ accepted: 1, rejected: 0, minIntervalSec: 60 }) });
        expect(getOutboxRuntime().intervalMs).toBe(DEFAULT_FLUSH_INTERVAL_MS);
    });

    it('429 按 Retry-After 退避，记录保留', async () => {
        await addEvents(1);
        const limited = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }));
        expect(await flushOutbox({ now: NOW, fetchImpl: limited })).toMatchObject({ status: 'failed', httpStatus: 429 });
        expect(getOutboxRuntime().nextAllowedAt).toBe(NOW.getTime() + 120_000);
        expect(await database.telemetryEvent.count()).toBe(2);
    });

    it('410 后本进程停止外发直到重启', async () => {
        await addEvents(1);
        const gone = vi.fn(async () => new Response('{}', { status: 410 }));
        expect(await flushOutbox({ now: NOW, fetchImpl: gone })).toMatchObject({ status: 'stopped' });
        const fetchMock = okFetch();
        expect((await flushOutbox({ now: new Date(NOW.getTime() + 24 * HOUR), force: true, fetchImpl: fetchMock })).status).toBe('stopped');
        expect(fetchMock).not.toHaveBeenCalled();
        resetOutboxRuntime();
        expect((await flushOutbox({ now: new Date(NOW.getTime() + 24 * HOUR), force: true, fetchImpl: fetchMock })).status).toBe('sent');
    });
});
