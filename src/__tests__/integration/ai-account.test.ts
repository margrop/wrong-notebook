// @vitest-environment node
/**
 * AI 用量与账户扩展（真实 SQLite）：补全用量写入 AiCompletion、按用户级联删除，
 * 默认实现的每日上限，以及删除用户后通知 AI 账户实现。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    session: null as null | { user: { id: string; email: string; role: string }; expires: string },
    config: { aiDailyLimit: 2 } as { aiDailyLimit?: number },
    onUserDeleted: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => mocks.config, getAppTimeZone: () => 'Asia/Shanghai' }));
// 默认实现之外，记录删除通知
vi.mock('@wrong-notebook/ai-account', async () => {
    const actual = await vi.importActual<typeof import('@/lib/ai/account-default')>('@/lib/ai/account-default');
    return { aiAccountProvider: { ...actual.aiAccountProvider, onUserDeleted: mocks.onUserDeleted } };
});

import { consumeAiQuota } from '@/lib/ai-quota';
import { recordAiCompletion } from '@/lib/ai/usage';
import { POST as SYSTEM_RESET } from '@/app/api/admin/system-reset/route';
import { DELETE as ADMIN_DELETE_USER } from '@/app/api/admin/users/[id]/route';

let database: PrismaClient;
let directory: string;
let admin: { id: string; email: string };
let alice: { id: string; email: string };
let bob: { id: string; email: string };

beforeAll(() => {
    // 数据库使用系统临时目录，不接触开发或生产数据
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-ai-account-test-'));
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } } });
    mocks.prisma = database;
}, 120000);

beforeEach(async () => {
    vi.clearAllMocks();
    mocks.session = null;
    mocks.config = { aiDailyLimit: 2 };
    mocks.onUserDeleted.mockResolvedValue(undefined);
    await database.aiCompletion.deleteMany();
    await database.externalAccount.deleteMany();
    await database.aiUsage.deleteMany();
    await database.user.deleteMany();
    admin = await database.user.create({ data: { email: 'admin@example.com', password: 'x', role: 'admin', aiDataConsentAt: new Date() } });
    alice = await database.user.create({ data: { email: 'alice@example.com', password: 'x', aiDataConsentAt: new Date() } });
    bob = await database.user.create({ data: { email: 'bob@example.com', password: 'x', aiDataConsentAt: new Date() } });
});

afterAll(async () => {
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('AiCompletion 用量记录', () => {
    it('写入每次补全的用量，删除用户时一并删除', async () => {
        await recordAiCompletion({ userId: alice.id, kind: 'analyze' }, 'deepseek', {
            task: 'analyze', status: 'succeeded', durationMs: 900, usage: { inputTokens: 1500, outputTokens: 300 }, model: 'deepseek-chat', requestId: 'gw-1',
        });
        await recordAiCompletion({ userId: alice.id, kind: 'mastery' }, 'deepseek', {
            task: 'mastery', status: 'failed', durationMs: 10, errorCode: 'AI_TIMEOUT_ERROR',
        });

        const rows = await database.aiCompletion.findMany({ where: { userId: alice.id }, orderBy: { createdAt: 'asc' } });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ kind: 'analyze', task: 'analyze', provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1500, outputTokens: 300, requestId: 'gw-1', status: 'succeeded' });
        expect(rows[1]).toMatchObject({ kind: 'mastery', status: 'failed', errorCode: 'AI_TIMEOUT_ERROR', inputTokens: null });

        await database.user.delete({ where: { id: alice.id } });
        expect(await database.aiCompletion.count()).toBe(0);
    });
});

describe('默认实现的每日上限', () => {
    it('达到上限后返回 429，管理员不受限制；后台评估的补全不占次数', async () => {
        await recordAiCompletion({ userId: alice.id, kind: 'mastery' }, 'openai', { task: 'mastery', status: 'succeeded', durationMs: 1 });

        expect(await consumeAiQuota({ id: alice.id, role: 'user' }, 'grade')).toBeNull();
        expect(await consumeAiQuota({ id: alice.id, role: 'user' }, 'grade')).toBeNull();
        const limited = await consumeAiQuota({ id: alice.id, role: 'user' }, 'grade');
        expect(limited?.status).toBe(429);
        expect(await limited?.json()).toMatchObject({ code: 'AI_DAILY_LIMIT_EXCEEDED', details: { limit: 2 } });
        expect(await database.aiUsage.count({ where: { userId: alice.id } })).toBe(2);

        for (let i = 0; i < 3; i++) {
            expect(await consumeAiQuota({ id: admin.id, role: 'admin' }, 'exam')).toBeNull();
        }
    });
});

describe('删除用户后通知 AI 账户实现', () => {
    it('管理员删除用户后通知，删除失败时不通知', async () => {
        mocks.session = { user: { id: admin.id, email: admin.email, role: 'admin' }, expires: '2099-01-01' };
        const remove = (id: string) => ADMIN_DELETE_USER(new Request(`http://localhost/api/admin/users/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) });

        expect((await remove(alice.id)).status).toBe(200);
        expect(mocks.onUserDeleted).toHaveBeenCalledWith(alice.id);

        mocks.onUserDeleted.mockClear();
        expect((await remove('missing-user')).status).toBe(500);
        expect(mocks.onUserDeleted).not.toHaveBeenCalled();
    });

    it('外部账号记录在用户删除后保留，通知时扩展仍可读取并自行清理', async () => {
        mocks.session = { user: { id: admin.id, email: admin.email, role: 'admin' }, expires: '2099-01-01' };
        await database.externalAccount.create({ data: { userId: alice.id, provider: 'gateway', externalId: '42', status: 'active', secret: 'encrypted' } });
        mocks.onUserDeleted.mockImplementation(async (userId: string) => {
            const account = await database.externalAccount.findUnique({ where: { userId_provider: { userId, provider: 'gateway' } } });
            expect(account?.externalId).toBe('42');
            await database.externalAccount.delete({ where: { id: account!.id } });
        });

        const response = await ADMIN_DELETE_USER(new Request('http://localhost', { method: 'DELETE' }), { params: Promise.resolve({ id: alice.id }) });

        expect(response.status).toBe(200);
        expect(mocks.onUserDeleted).toHaveBeenCalledWith(alice.id);
        expect(await database.externalAccount.count()).toBe(0);
    });

    it('通知出错不影响删除结果', async () => {
        mocks.session = { user: { id: admin.id, email: admin.email, role: 'admin' }, expires: '2099-01-01' };
        mocks.onUserDeleted.mockRejectedValue(new Error('gateway down'));

        const response = await ADMIN_DELETE_USER(new Request('http://localhost', { method: 'DELETE' }), { params: Promise.resolve({ id: bob.id }) });

        expect(response.status).toBe(200);
        expect(await database.user.findUnique({ where: { id: bob.id } })).toBeNull();
    });

    it('系统初始化删除其他用户后逐个通知', async () => {
        mocks.session = { user: { id: admin.id, email: admin.email, role: 'admin' }, expires: '2099-01-01' };

        expect((await SYSTEM_RESET()).status).toBe(200);

        expect(mocks.onUserDeleted.mock.calls.map((call) => call[0]).sort()).toEqual([alice.id, bob.id].sort());
    });
});
