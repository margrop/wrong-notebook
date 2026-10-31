// @vitest-environment node
/**
 * 会删除或暴露数据的接口（真实 SQLite）：批量删除、系统重置、管理后台、自定义标签。
 * 重点验证权限边界和删除范围，避免误删其他用户的数据。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    session: null as null | { user: { id: string; email: string; role: string }; expires: string },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('@/lib/logger', () => ({ createLogger: () => mocks.logger }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));

import { POST as BATCH_DELETE } from '@/app/api/error-items/batch-delete/route';
import { POST as SYSTEM_RESET } from '@/app/api/admin/system-reset/route';
import { GET as DASHBOARD } from '@/app/api/admin/dashboard/route';
import { GET as USER_DETAIL } from '@/app/api/admin/users/[id]/detail/route';
import { GET as GET_TAGS, POST as CREATE_TAG, DELETE as DELETE_TAG } from '@/app/api/tags/route';

let database: PrismaClient;
let directory: string;
let admin: { id: string; email: string };
let alice: { id: string; email: string };
let bob: { id: string; email: string };

const signInAs = (user: { id: string; email: string }, role = 'user') => {
    mocks.session = { user: { id: user.id, email: user.email, role }, expires: '2099-01-01' };
};
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const createItem = (userId: string, subjectId?: string) =>
    database.errorItem.create({ data: { userId, subjectId, originalImageUrl: 'data:image/png;base64,AA==' } });

beforeAll(() => {
    // 数据库使用系统临时目录，不接触开发或生产数据
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-data-safety-test-'));
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
    await database.practiceRecord.deleteMany();
    await database.errorItem.deleteMany();
    await database.subject.deleteMany();
    await database.knowledgeTag.deleteMany();
    await database.user.deleteMany();
    admin = await database.user.create({ data: { email: 'admin@example.com', password: 'x', role: 'admin', name: '管理员' } });
    alice = await database.user.create({ data: { email: 'alice@example.com', password: 'x', name: 'Alice' } });
    bob = await database.user.create({ data: { email: 'bob@example.com', password: 'x', name: 'Bob' } });
});

afterAll(async () => {
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('POST /api/error-items/batch-delete', () => {
    const send = (ids: unknown) => BATCH_DELETE(new Request('http://localhost/api/error-items/batch-delete', json({ ids })));

    it('未登录时拒绝，不删除任何错题', async () => {
        const item = await createItem(alice.id);

        expect((await send([item.id])).status).toBe(401);
        expect(await database.errorItem.count()).toBe(1);
    });

    it('只删除自己的错题，其他用户的和不存在的 ID 列为失败', async () => {
        const mine = await createItem(alice.id);
        const theirs = await createItem(bob.id);
        signInAs(alice);

        const response = await send([mine.id, theirs.id, 'missing']);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ deleted: 1, failed: [theirs.id, 'missing'] });
        expect(await database.errorItem.findUnique({ where: { id: theirs.id } })).not.toBeNull();
        expect(await database.errorItem.findUnique({ where: { id: mine.id } })).toBeNull();
    });

    it('拒绝空列表、非数组和一次超过 100 条', async () => {
        signInAs(alice);

        expect((await send([])).status).toBe(400);
        expect((await send('abc')).status).toBe(400);
        expect((await send(Array.from({ length: 101 }, (_, i) => `id-${i}`))).status).toBe(400);
    });
});

describe('POST /api/admin/system-reset', () => {
    it('普通用户不能重置系统', async () => {
        await createItem(alice.id);
        signInAs(alice);

        expect((await SYSTEM_RESET()).status).toBe(403);
        expect(await database.errorItem.count()).toBe(1);
        expect(await database.user.count()).toBe(3);
    });

    it('未登录时返回 401', async () => {
        expect((await SYSTEM_RESET()).status).toBe(401);
    });

    it('管理员重置后清空所有数据和其他用户，保留自己的账号和系统标签', async () => {
        const subject = await database.subject.create({ data: { name: '数学', userId: alice.id } });
        await createItem(alice.id, subject.id);
        await createItem(admin.id);
        await database.practiceRecord.create({ data: { userId: bob.id } });
        await database.knowledgeTag.create({ data: { name: '系统标签', subject: 'math', isSystem: true } });
        await database.knowledgeTag.create({ data: { name: '自定义', subject: 'math', userId: alice.id } });
        signInAs(admin, 'admin');

        expect((await SYSTEM_RESET()).status).toBe(200);

        expect(await database.errorItem.count()).toBe(0);
        expect(await database.practiceRecord.count()).toBe(0);
        expect(await database.subject.count()).toBe(0);
        expect((await database.user.findMany()).map((u) => u.email)).toEqual(['admin@example.com']);
        expect((await database.knowledgeTag.findMany()).map((t) => t.name)).toEqual(['系统标签']);
    });
});

describe('管理后台接口', () => {
    it('普通用户不能查看仪表盘和用户详情', async () => {
        signInAs(alice);

        expect((await DASHBOARD()).status).toBe(403);
        expect((await USER_DETAIL(new Request('http://localhost'), { params: Promise.resolve({ id: bob.id }) })).status).toBe(403);
    });

    it('仪表盘统计全站数据', async () => {
        await createItem(alice.id);
        await createItem(bob.id);
        signInAs(admin, 'admin');

        const response = await DASHBOARD();
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(JSON.stringify(data)).not.toContain('"password"');
        expect(data).toMatchObject({ overview: expect.objectContaining({ totalUsers: 3, totalErrorItems: 2 }) });
    });

    it('学科分布把不同用户的同名错题本合并计数', async () => {
        const aliceEnglish = await database.subject.create({ data: { name: '英语', userId: alice.id } });
        const bobEnglish = await database.subject.create({ data: { name: '英语', userId: bob.id } });
        const bobMath = await database.subject.create({ data: { name: '数学', userId: bob.id } });
        await createItem(alice.id, aliceEnglish.id);
        await createItem(bob.id, bobEnglish.id);
        await createItem(bob.id, bobMath.id);
        signInAs(admin, 'admin');

        const data = await (await DASHBOARD()).json();

        expect(data.subjectDistribution).toEqual([{ name: '英语', count: 2 }, { name: '数学', count: 1 }]);
    });

    it('用户详情只统计该用户的数据，不返回密码', async () => {
        const subject = await database.subject.create({ data: { name: '数学', userId: alice.id } });
        await createItem(alice.id, subject.id);
        await createItem(alice.id, subject.id);
        await createItem(bob.id);
        signInAs(admin, 'admin');

        const response = await USER_DETAIL(new Request('http://localhost'), { params: Promise.resolve({ id: alice.id }) });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(JSON.stringify(data)).not.toContain('"password"');
        expect(JSON.stringify(data)).toContain('alice@example.com');
        expect(JSON.stringify(data)).not.toContain('bob@example.com');
    });

    it('用户不存在时返回 404', async () => {
        signInAs(admin, 'admin');

        const response = await USER_DETAIL(new Request('http://localhost'), { params: Promise.resolve({ id: 'missing' }) });

        expect(response.status).toBe(404);
    });
});

describe('/api/tags 自定义标签', () => {
    const request = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://localhost${url}`, init);

    it('未登录时拒绝读取和创建', async () => {
        expect((await GET_TAGS(request('/api/tags?subject=math'))).status).toBe(401);
        expect((await CREATE_TAG(request('/api/tags', json({ name: 'x', subject: 'math' })))).status).toBe(401);
    });

    it('返回系统标签和自己的标签树，看不到别人的自定义标签', async () => {
        const chapter = await database.knowledgeTag.create({ data: { name: '方程', subject: 'math', isSystem: true } });
        await database.knowledgeTag.create({ data: { name: '一元一次方程', subject: 'math', isSystem: true, parentId: chapter.id } });
        await database.knowledgeTag.create({ data: { name: 'Alice 的标签', subject: 'math', userId: alice.id } });
        await database.knowledgeTag.create({ data: { name: 'Bob 的标签', subject: 'math', userId: bob.id } });
        signInAs(alice);

        const tree = await (await GET_TAGS(request('/api/tags?subject=math'))).json();
        const flat = await (await GET_TAGS(request('/api/tags?subject=math&flat=true'))).json();

        expect(JSON.stringify(tree)).not.toContain('Bob 的标签');
        const root = tree.tags.find((t: { name: string }) => t.name === '方程');
        expect(root.children.map((c: { name: string }) => c.name)).toEqual(['一元一次方程']);
        // 扁平列表只含叶子节点，并带上父节点名称
        expect(flat.tags).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: '一元一次方程', parentName: '方程' }),
            expect.objectContaining({ name: 'Alice 的标签', parentName: null }),
        ]));
        expect(flat.tags.map((t: { name: string }) => t.name)).not.toContain('方程');
    });

    it('缺少学科时返回 400', async () => {
        signInAs(alice);
        expect((await GET_TAGS(request('/api/tags'))).status).toBe(400);
    });

    it('创建自定义标签，同一分组下重名返回 409', async () => {
        signInAs(alice);

        const created = await CREATE_TAG(request('/api/tags', json({ name: '  我的标签 ', subject: 'math' })));
        const duplicate = await CREATE_TAG(request('/api/tags', json({ name: '我的标签', subject: 'math' })));

        expect(created.status).toBe(201);
        await expect(created.json()).resolves.toMatchObject({ tag: { name: '我的标签', userId: alice.id, isSystem: false } });
        expect(duplicate.status).toBe(409);
        expect((await CREATE_TAG(request('/api/tags', json({ subject: 'math' })))).status).toBe(400);
    });

    it('只能删除自己的自定义标签，不能删系统标签或别人的标签', async () => {
        const system = await database.knowledgeTag.create({ data: { name: '系统', subject: 'math', isSystem: true } });
        const bobs = await database.knowledgeTag.create({ data: { name: 'Bob', subject: 'math', userId: bob.id } });
        const mine = await database.knowledgeTag.create({ data: { name: '我的', subject: 'math', userId: alice.id } });
        signInAs(alice);

        expect((await DELETE_TAG(request(`/api/tags?id=${system.id}`, { method: 'DELETE' }))).status).toBe(404);
        expect((await DELETE_TAG(request(`/api/tags?id=${bobs.id}`, { method: 'DELETE' }))).status).toBe(404);
        expect((await DELETE_TAG(request(`/api/tags?id=${mine.id}`, { method: 'DELETE' }))).status).toBe(200);
        expect((await DELETE_TAG(request('/api/tags', { method: 'DELETE' }))).status).toBe(400);
        expect((await database.knowledgeTag.findMany()).map((t) => t.name).sort()).toEqual(['Bob', '系统']);
    });
});
