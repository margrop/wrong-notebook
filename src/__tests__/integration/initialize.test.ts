// @vitest-environment node
/**
 * 一次性初始化链接：全新安装没有管理员时，用配置目录中的令牌创建第一个管理员（真实 SQLite）
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { compare, hashSync } from 'bcryptjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('@/lib/logger', () => ({ createLogger: () => mocks.logger }));

import { POST } from '@/app/api/initialize/route';
import { GET as GET_STATUS } from '@/app/api/register/status/route';
import { announceSetupLink, setupLinkFor } from '@/lib/initialization';
import { ensureSetupToken } from '@/lib/setup-token';
import { registerIpLimiter } from '@/lib/rate-limit';

let database: PrismaClient;
let directory: string;
let configDir: string;
const tokenFile = () => join(configDir, 'setup-token');
const initialize = (body: object) => POST(new Request('http://localhost/api/initialize', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
}));
const valid = (token: string) => ({ token, name: '管理员', email: 'owner@example.com', password: 'secret-pass' });

beforeAll(() => {
    // 数据库与配置目录都使用系统临时目录，不接触开发或生产数据
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-initialize-test-'));
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
    registerIpLimiter.reset('unknown');
    await database.user.deleteMany();
    configDir = mkdtempSync(join(directory, 'config-'));
    vi.stubEnv('CONFIG_DIR', configDir);
    vi.stubEnv('NEXTAUTH_URL', 'http://192.168.1.10:3000/');
});

afterAll(async () => {
    vi.unstubAllEnvs();
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('启动时的初始化链接', () => {
    it('没有管理员时生成令牌并在日志中打印完整链接', async () => {
        await announceSetupLink();

        expect(existsSync(tokenFile())).toBe(true);
        const token = ensureSetupToken();
        expect(token).toMatch(/^[\w-]{32}$/);
        const link = setupLinkFor(token);
        expect(link).toBe(`http://192.168.1.10:3000/initialize?token=${token}`);
        expect(mocks.logger.warn).toHaveBeenCalledWith({ link }, expect.stringContaining(link));
    });

    it('重启后沿用同一个令牌，已打印的链接仍然有效', async () => {
        await announceSetupLink();
        const first = ensureSetupToken();
        await announceSetupLink();
        expect(ensureSetupToken()).toBe(first);
    });

    it('已有管理员时删除残留令牌，不打印链接', async () => {
        ensureSetupToken();
        await database.user.create({ data: { email: 'admin@localhost', password: 'x', role: 'admin' } });

        await announceSetupLink();

        expect(existsSync(tokenFile())).toBe(false);
        expect(mocks.logger.warn).not.toHaveBeenCalled();
    });
});

describe('安装程序预设的管理员（initial-admin.json）', () => {
    const presetFile = () => join(configDir, 'initial-admin.json');
    const writePreset = (content: object | string) =>
        writeFileSync(presetFile(), typeof content === 'string' ? content : JSON.stringify(content));

    it('启动时用预设的邮箱和密码哈希创建管理员，删除预设文件，不再生成初始化链接', async () => {
        writePreset({ email: 'nas@localhost', name: 'Admin', passwordHash: hashSync('nas-secret', 4) });

        await announceSetupLink();

        const admin = await database.user.findUniqueOrThrow({ where: { email: 'nas@localhost' } });
        expect(admin).toMatchObject({ role: 'admin', isActive: true, name: 'Admin' });
        expect(await compare('nas-secret', admin.password)).toBe(true);
        expect(readdirSync(configDir)).toEqual([]);
        expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('预设内容无效时删除文件，改为打印初始化链接', async () => {
        writePreset({ email: 'nas@localhost', passwordHash: 'plain-text-password' });

        await announceSetupLink();

        expect(await database.user.count()).toBe(0);
        expect(existsSync(presetFile())).toBe(false);
        expect(existsSync(tokenFile())).toBe(true);
        expect(mocks.logger.warn).toHaveBeenCalled();
    });

    it('已有管理员（保留数据重装）时忽略并删除预设，不改动原账号', async () => {
        await database.user.create({ data: { email: 'admin@localhost', password: 'keep', role: 'admin' } });
        writePreset({ email: 'admin@localhost', passwordHash: hashSync('new-secret', 4) });

        await announceSetupLink();

        expect(await database.user.findUniqueOrThrow({ where: { email: 'admin@localhost' } })).toMatchObject({ password: 'keep' });
        expect(existsSync(presetFile())).toBe(false);
    });
});

describe('POST /api/initialize', () => {
    it('令牌正确时创建管理员并删除令牌，链接只能用一次', async () => {
        const token = ensureSetupToken();

        const response = await initialize(valid(token));

        expect(response.status).toBe(201);
        const admin = await database.user.findUniqueOrThrow({ where: { email: 'owner@example.com' } });
        expect(admin).toMatchObject({ name: '管理员', role: 'admin', isActive: true });
        expect(await compare('secret-pass', admin.password)).toBe(true);
        expect(existsSync(tokenFile())).toBe(false);
        expect(readdirSync(configDir)).toEqual([]);

        expect((await initialize({ ...valid(token), email: 'second@example.com' })).status).toBe(409);
        expect(await database.user.count()).toBe(1);
    });

    it('令牌错误或缺失时拒绝，令牌保留可继续使用', async () => {
        const token = ensureSetupToken();

        expect((await initialize(valid('wrong-token'))).status).toBe(403);
        expect((await initialize({ ...valid(token), token: '' })).status).toBe(400);
        expect(await database.user.count()).toBe(0);
        expect(ensureSetupToken()).toBe(token);
    });

    it('同一 IP 猜错令牌 10 次后，即使令牌正确也先拒绝', async () => {
        const token = ensureSetupToken();
        for (let i = 0; i < 10; i++) {
            expect((await initialize(valid(`guess-${i}`))).status).toBe(403);
        }

        expect((await initialize(valid(token))).status).toBe(429);
        expect(await database.user.count()).toBe(0);
    });

    it('没有令牌文件时任何令牌都无效', async () => {
        expect((await initialize(valid('anything'))).status).toBe(403);
        expect(await database.user.count()).toBe(0);
    });

    it('同时提交两次只会创建一个管理员', async () => {
        const token = ensureSetupToken();

        const statuses = (await Promise.all([
            initialize(valid(token)),
            initialize({ ...valid(token), email: 'other@example.com' }),
        ])).map((response) => response.status).sort();

        expect(statuses[0]).toBe(201);
        expect([403, 409]).toContain(statuses[1]);
        expect(await database.user.count({ where: { role: 'admin' } })).toBe(1);
    });

    it('拒绝过短的密码和旧的默认密码 123456', async () => {
        const token = ensureSetupToken();

        expect((await initialize({ ...valid(token), password: '12345' })).status).toBe(400);
        expect((await initialize({ ...valid(token), password: '123456' })).status).toBe(400);
        expect(await database.user.count()).toBe(0);
    });

    it('邮箱已被普通用户占用时返回 ALREADY_EXISTS，不改动其账号，令牌保留', async () => {
        const token = ensureSetupToken();
        await database.user.create({ data: { email: 'owner@example.com', password: 'keep', role: 'user' } });

        const response = await initialize(valid(token));

        expect(response.status).toBe(409);
        expect((await response.json()).code).toBe('ALREADY_EXISTS');
        expect(await database.user.findUniqueOrThrow({ where: { email: 'owner@example.com' } })).toMatchObject({ role: 'user', password: 'keep' });
        expect(ensureSetupToken()).toBe(token);
    });
});

describe('GET /api/register/status 初始化状态', () => {
    it('没有管理员时 initialized 为 false，创建后为 true', async () => {
        expect(await (await GET_STATUS()).json()).toMatchObject({ initialized: false });
        await database.user.create({ data: { email: 'admin@localhost', password: 'x', role: 'admin' } });
        expect(await (await GET_STATUS()).json()).toMatchObject({ initialized: true });
    });
});
