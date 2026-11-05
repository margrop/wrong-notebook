// @vitest-environment node
/**
 * /api/admin/telemetry（真实 SQLite）：权限、读取状态与最近记录、修改校验、未同意协议时不能开启外发、立即清空
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
    getServerSession: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('@/lib/config', () => ({
    getAppConfig: () => mocks.config,
    updateAppConfig: (patch: Partial<AppConfig>) => {
        mocks.config = { ...mocks.config, ...patch, eula: { ...mocks.config.eula, ...patch.eula }, telemetry: { ...mocks.config.telemetry, ...patch.telemetry } };
        return mocks.config;
    },
}));

import { DELETE, GET, POST } from '@/app/api/admin/telemetry/route';
import { isValidTelemetryEndpoint } from '@/lib/telemetry/admin';

let database: PrismaClient;
let directory: string;
const admin = { user: { id: 'admin-1', email: 'admin@localhost', role: 'admin' }, expires: '2099-01-01' };
const user = { user: { id: 'user-1', email: 'user@localhost', role: 'user' }, expires: '2099-01-01' };

const get = (query = '') => GET(new Request(`http://localhost/api/admin/telemetry${query}`));
const post = (body: unknown) => POST(new Request('http://localhost/api/admin/telemetry', { method: 'POST', body: JSON.stringify(body) }));

async function signIn(session: typeof admin) {
    mocks.getServerSession.mockResolvedValue(session);
    await database.user.upsert({ where: { email: session.user.email }, update: {}, create: { id: session.user.id, email: session.user.email, password: 'x', role: session.user.role } });
}

beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-admin-telemetry-test-'));
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
    mocks.config = { telemetry: { recording: false, errors: true, forwarding: false, endpoint: '', retentionDays: 30 } };
    await database.telemetryEvent.deleteMany();
    await database.telemetryError.deleteMany();
    await signIn(admin);
});

afterAll(async () => {
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('/api/admin/telemetry', () => {
    it('普通用户 403', async () => {
        await signIn(user);
        expect((await get()).status).toBe(403);
        expect((await post({ recording: true })).status).toBe(403);
        expect((await DELETE()).status).toBe(403);
    });

    it('GET 返回状态、待发数量与最近记录；存量实例显示告知横幅', async () => {
        await database.telemetryEvent.create({ data: { name: 'app_opened', payload: '{"client":"pwa"}', version: 'v', local: true } });
        await database.telemetryError.create({ data: { kind: 'client', scope: 's', name: 'Error', fingerprint: '0123456789abcdef', message: 'm', version: 'v', local: true } });
        const body = await (await get()).json();
        expect(body).toMatchObject({
            recording: false, errors: true, forwarding: false, forwardingActive: false, endpoint: '', lockedByEnv: false,
            showNotice: true, pending: 2, lastFlushAt: null, eula: { current: 'v1', acceptedVersion: null },
        });
        expect(body.defaultEndpoint).toBe('https://wrong-notebook-telemetry.margrop.net/api/v1/ingest');
        expect(body.events).toEqual([expect.objectContaining({ name: 'app_opened', payload: '{"client":"pwa"}' })]);
        expect(body.errorRecords).toEqual([expect.objectContaining({ fingerprint: '0123456789abcdef', message: 'm' })]);

        const notice = await (await get('?view=notice')).json();
        expect(notice).toMatchObject({ showNotice: true });
        expect(notice).not.toHaveProperty('events');
    });

    it('未同意协议时不能开启外发；同意后可以；关闭横幅后不再显示', async () => {
        expect((await post({ forwarding: true })).status).toBe(409);
        mocks.config.eula = { acceptedVersion: 'v0' };
        expect((await post({ forwarding: true })).status).toBe(409);
        mocks.config.eula = { acceptedVersion: 'v1' };
        const response = await post({ forwarding: true, recording: true, retentionDays: 90 });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ forwarding: true, forwardingActive: true, recording: true, retentionDays: 90, showNotice: false });

        mocks.config = { telemetry: {} };
        expect(await (await post({ noticeDismissed: true })).json()).toMatchObject({ showNotice: false });
        expect(mocks.config.telemetry?.noticeDismissedAt).toBeTruthy();
    });

    it('校验参数：保留天数、多余字段与地址', async () => {
        expect((await post({ retentionDays: 0 })).status).toBe(400);
        expect((await post({ retentionDays: 366 })).status).toBe(400);
        expect((await post({ lastFlushAt: '2026-01-01' })).status).toBe(400);
        expect((await post({ endpoint: 'http://example.com/ingest' })).status).toBe(400);
        expect((await post({ endpoint: 'http://192.168.1.10:3000/api/v1/ingest' })).status).toBe(200);
        expect((await post({ endpoint: '' })).status).toBe(200);
    });

    it('TELEMETRY_DISABLED 时设置只读', async () => {
        vi.stubEnv('TELEMETRY_DISABLED', 'true');
        expect((await post({ recording: true })).status).toBe(409);
        expect(await (await get()).json()).toMatchObject({ lockedByEnv: true, showNotice: false });
    });

    it('DELETE 清空全部记录', async () => {
        await database.telemetryEvent.create({ data: { name: 'app_opened', version: 'v', local: false } });
        const body = await (await DELETE()).json();
        expect(body).toMatchObject({ pending: 0, events: [] });
        expect(await database.telemetryEvent.count()).toBe(0);
    });
});

describe('isValidTelemetryEndpoint', () => {
    it('只允许 https，局域网与本机地址可以用 http，不允许携带账号', () => {
        expect(isValidTelemetryEndpoint('https://t.example.com/api/v1/ingest')).toBe(true);
        expect(isValidTelemetryEndpoint('http://localhost:3000/api/v1/ingest')).toBe(true);
        expect(isValidTelemetryEndpoint('http://10.0.0.1/api')).toBe(true);
        // 172 开头但不在私有网段内的地址不算局域网
        expect(isValidTelemetryEndpoint('http://172.32.0.1/api')).toBe(false);
        expect(isValidTelemetryEndpoint('http://nas.local/api')).toBe(true);
        expect(isValidTelemetryEndpoint('https://user:pw@t.example.com/')).toBe(false);
        expect(isValidTelemetryEndpoint('ftp://t.example.com/')).toBe(false);
        expect(isValidTelemetryEndpoint('not a url')).toBe(false);
    });
});
