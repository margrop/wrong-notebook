// @vitest-environment node
/**
 * POST /api/telemetry 与遥测写入、清理（真实 SQLite）：四种开关组合的写入规则、校验、限流与保留期
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@/lib/config/types';

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    config: {} as Partial<AppConfig>,
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => mocks.config }));

import { POST } from '@/app/api/telemetry/route';
import { telemetryIpLimiter } from '@/lib/rate-limit';
import { clearTelemetry, purgeTelemetry, recordEvent, reportServerError, resetErrorDedupe } from '@/lib/telemetry/server';
import { getTelemetryState } from '@/lib/telemetry/state';

let database: PrismaClient;
let directory: string;

function post(body: unknown, ip: string | null = '9.9.9.9') {
    const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
    if (ip) headers['X-Forwarded-For'] = ip;
    return POST(new Request('http://localhost/api/telemetry', {
        method: 'POST',
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
    }));
}

function setSwitches(recording: boolean, forwarding: boolean, errors = true) {
    mocks.config = { eula: { acceptedVersion: 'v1' }, telemetry: { recording, forwarding, errors, retentionDays: 30 } };
}

const clientError = {
    t: 'error', kind: 'client', scope: '[GlobalError]', name: 'TypeError',
    message: 'boom for a@b.com', stack: 'TypeError: boom\n    at f (http://h:3000/_next/static/chunks/a-1234abcd.js:1:2)',
    path: '/error-items/clxabc123def456ghi789jkl', userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile Safari/537.36',
};

beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-telemetry-test-'));
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
    telemetryIpLimiter.reset('9.9.9.9');
    telemetryIpLimiter.reset('unknown');
    resetErrorDedupe();
    await clearTelemetry();
    setSwitches(false, false);
});

afterAll(async () => {
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('写入规则', () => {
    it('两个开关都关：返回 202 且不写库', async () => {
        const response = await post({ t: 'event', name: 'app_opened', payload: { client: 'browser' } });
        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({ accepted: false });
        expect(await database.telemetryEvent.count()).toBe(0);
    });

    it('只开本地记录：完整记录，local=true', async () => {
        setSwitches(true, false);
        expect((await post({ t: 'event', name: 'page_viewed', payload: { page: 'stats' } })).status).toBe(200);
        expect((await post(clientError)).status).toBe(200);
        const event = await database.telemetryEvent.findFirstOrThrow();
        expect(event).toMatchObject({ name: 'page_viewed', payload: '{"page":"stats"}', local: true });
        const error = await database.telemetryError.findFirstOrThrow();
        expect(error).toMatchObject({
            kind: 'client', scope: '[GlobalError]', name: 'TypeError', local: true,
            message: 'boom for <email>', path: '/error-items/:id', userAgent: 'Chrome 140 / Android',
        });
        expect(error.fingerprint).toMatch(/^[0-9a-f]{16}$/);
        expect(error.stack).toContain('/_next/static/chunks/');
        expect(error.stack).not.toContain('http://h:3000');
    });

    it('只开外发：错误不保存 message、stack、path、UA，local=false', async () => {
        setSwitches(false, true);
        expect((await post(clientError)).status).toBe(200);
        expect(await database.telemetryError.findFirstOrThrow()).toMatchObject({
            local: false, message: null, stack: null, path: null, userAgent: null,
        });
    });

    it('两个都开：完整记录且 local=true', async () => {
        setSwitches(true, true);
        await post(clientError);
        expect(await database.telemetryError.findFirstOrThrow()).toMatchObject({ local: true, path: '/error-items/:id' });
    });

    it('错误回报关闭时错误返回 202，事件照常写入', async () => {
        setSwitches(true, true, false);
        expect((await post(clientError)).status).toBe(202);
        expect((await post({ t: 'event', name: 'app_opened', payload: { client: 'pwa' } })).status).toBe(200);
        expect(await database.telemetryError.count()).toBe(0);
        expect(await database.telemetryEvent.count()).toBe(1);
    });

    it('协议待重新同意时外发暂停，只开外发的实例不写库', async () => {
        mocks.config = { eula: { acceptedVersion: 'v0' }, telemetry: { forwarding: true } };
        expect((await post({ t: 'event', name: 'app_opened', payload: { client: 'pwa' } })).status).toBe(202);
    });

    it('TELEMETRY_DISABLED=true 时全部不写', async () => {
        setSwitches(true, true);
        vi.stubEnv('TELEMETRY_DISABLED', 'true');
        expect((await post({ t: 'event', name: 'app_opened', payload: { client: 'pwa' } })).status).toBe(202);
        expect(await database.telemetryEvent.count()).toBe(0);
    });

    it('同一错误 1 分钟内只写一行', async () => {
        setSwitches(true, false);
        await post(clientError);
        await post(clientError);
        expect(await database.telemetryError.count()).toBe(1);
    });
});

describe('校验与限流', () => {
    beforeEach(() => setSwitches(true, true));

    it('非法事件、自由文本、服务端专用事件与服务端错误一律 400', async () => {
        expect((await post('not json')).status).toBe(400);
        expect((await post({ t: 'event', name: 'page_viewed', payload: { page: '/secret/path' } })).status).toBe(400);
        expect((await post({ t: 'event', name: 'instance_alive', payload: { platform: 'docker', aiConfigured: true } })).status).toBe(400);
        expect((await post({ ...clientError, kind: 'server' })).status).toBe(400);
        expect((await post({ ...clientError, scope: 'has space' })).status).toBe(400);
        expect((await post({ t: 'event', name: 'app_opened', payload: { client: 'pwa' }, userId: 'x' })).status).toBe(400);
        expect(await database.telemetryEvent.count()).toBe(0);
    });

    it('请求体超过 16KB 返回 413', async () => {
        expect((await post({ ...clientError, message: 'x'.repeat(17 * 1024) })).status).toBe(413);
    });

    it('同一来源每分钟 60 次后返回 429；取不到 IP 时共用 unknown', async () => {
        for (let i = 0; i < 60; i++) await post('x', null);
        const limited = await post('x', null);
        expect(limited.status).toBe(429);
        expect(limited.headers.get('Retry-After')).toBeTruthy();
        expect((await post('x', '9.9.9.9')).status).toBe(400);
    });
});

describe('服务端门面与清理', () => {
    it('recordEvent 校验 payload，非法时不写；reportServerError 绝不抛错', async () => {
        setSwitches(false, true);
        expect(await recordEvent('instance_alive', { platform: 'docker', aiConfigured: true })).toBe(true);
        // @ts-expect-error 故意传入非法 payload
        expect(await recordEvent('instance_alive', { platform: 'mars' })).toBe(false);
        await expect(reportServerError('api:ai', new TypeError('bad'))).resolves.toBeUndefined();
        expect(await database.telemetryError.findFirstOrThrow()).toMatchObject({ kind: 'server', scope: 'api:ai', name: 'TypeError', local: false });
    });

    it('按保留期删除本地记录，删除 7 天未发出与已发出的待发记录', async () => {
        const now = new Date('2026-11-05T00:00:00Z');
        const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
        const base = { name: 'app_opened', version: 'test' };
        await database.telemetryEvent.createMany({ data: [
            { ...base, local: true, createdAt: daysAgo(31) },
            { ...base, local: true, createdAt: daysAgo(29), forwardedAt: daysAgo(28) },
            { ...base, local: false, createdAt: daysAgo(8) },
            { ...base, local: false, createdAt: daysAgo(6) },
            { ...base, local: false, createdAt: daysAgo(1), forwardedAt: daysAgo(1) },
        ] });
        setSwitches(false, false);
        expect(await purgeTelemetry(now, getTelemetryState())).toBe(3);
        const left = await database.telemetryEvent.findMany({ orderBy: { createdAt: 'asc' } });
        expect(left.map((row) => [row.local, row.forwardedAt !== null])).toEqual([[true, true], [false, false]]);
    });
});
