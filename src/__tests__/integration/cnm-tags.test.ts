// @vitest-environment node
/**
 * 人教版课标知识点导入：管理员接口权限、年级节点命名与学段筛选、增量导入、旧脚本节点改名
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    getServerSession: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET, POST } from '@/app/api/admin/cnm-tags/route';
import { getNotebookCandidateTags } from '@/lib/ai/tag-service';
import { CNM_TAG_SET, cnmGradeNodeName } from '@/lib/tags/seed';

const admin = { user: { id: 'admin-1', email: 'admin@localhost', role: 'admin' }, expires: '2099-01-01' };
const user = { user: { id: 'user-1', email: 'user@localhost', role: 'user' }, expires: '2099-01-01' };

const topics = [
    { id: 'cnm_p001', name: '1到5各数的认识', grade: 1, semester: '上', chapter: '一年级上册 第1单元' },
    { id: 'cnm_j001', name: '正数和负数', grade: 7, semester: '上', chapter: '七年级上册 第一章 有理数' },
    { id: 'cnm_j002', name: '有理数的加法', grade: 7, semester: '上', chapter: '七年级上册 第一章 有理数' },
    { id: 'cnm_s001', name: '集合的概念', grade: 10, semester: '上', chapter: '高一 第一章 集合' },
    { id: 'cnm_s002', name: '数列的概念', grade: 13, semester: '上', chapter: '选必二 第四章 数列 4.1' },
    { id: 'cnm_e001', name: '一般现在时', subject: 'english', grade: 9, semester: '全', chapter: '九年级 Unit 1' },
    { id: 'cnm_m001', name: '规则意识', subject: 'morality', grade: 8, semester: '上', chapter: '八年级上册 第三单元' },
    { id: 'cnm_x001', name: '植物的生长', subject: 'science', grade: 3, semester: '上', chapter: '三年级上册' },
];

let database: PrismaClient;
let directory: string;

function importTopics(body: unknown) {
    return POST(new Request('http://localhost/api/admin/cnm-tags', { method: 'POST', body: JSON.stringify(body) }));
}

beforeAll(() => {
    // 只在系统临时目录执行迁移和真实数据库读写。
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-cnm-tags-'));
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } } });
    mocks.prisma = database;
}, 120000);

beforeEach(async () => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(admin);
    await database.knowledgeTag.deleteMany();
    // withAdmin 包装器通过 prisma 查询用户，需确保管理员用户存在
    await database.user.upsert({
        where: { email: 'admin@localhost' },
        update: {},
        create: { email: 'admin@localhost', name: 'Admin', role: 'admin', password: 'x' },
    });
});

afterAll(async () => {
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('年级节点命名', () => {
    it('小学初中按年级学期命名，高中按册名命名', () => {
        expect(cnmGradeNodeName({ grade: 3, semester: '下', chapter: '' })).toBe('三年级下');
        expect(cnmGradeNodeName({ grade: 9, semester: '全', chapter: '' })).toBe('九年级');
        expect(cnmGradeNodeName({ grade: 11, semester: '上', chapter: '高二 第五章' })).toBe('高二');
        expect(cnmGradeNodeName({ grade: 12, semester: '上', chapter: '选必一 第一章' })).toBe('高中 选必一');
        expect(cnmGradeNodeName({ grade: 0, semester: '上', chapter: 'x' })).toBeNull();
    });
});

describe('/api/admin/cnm-tags', () => {
    it('未登录返回 401，普通用户返回 403', async () => {
        mocks.getServerSession.mockResolvedValue(null);
        expect((await GET()).status).toBe(401);
        // 确保普通用户存在于数据库中，使 resolveUser 能找到该用户后再判 403
        await database.user.upsert({
            where: { email: 'user@localhost' },
            update: {},
            create: { email: 'user@localhost', name: 'User', role: 'user', password: 'x' },
        });
        mocks.getServerSession.mockResolvedValue(user);
        expect((await GET()).status).toBe(403);
        expect((await importTopics({ topics })).status).toBe(403);
    });

    it('文件格式不对返回 400', async () => {
        expect((await importTopics({ topics: { name: 'x' } })).status).toBe(400);
        expect((await importTopics({ topics: [{ name: '缺少年级' }] })).status).toBe(400);
        expect((await importTopics({})).status).toBe(400);
    });

    it('导入后按学段取得候选知识点，跳过不支持的学科，重复导入不新增', async () => {
        const response = await importTopics({ topics });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.result).toEqual({ total: 8, created: 7, skipped: 0, ignored: 1 });
        expect(body.status).toMatchObject({ tagSet: CNM_TAG_SET, knowledgePoints: 7, subjects: { math: 5, english: 1, politics: 1 } });

        const roots = await database.knowledgeTag.findMany({ where: { tagSet: CNM_TAG_SET, parentId: null }, orderBy: { name: 'asc' } });
        expect(roots.map((tag) => tag.name).sort()).toEqual(['一年级上', '九年级', '八年级上', '七年级上', '高一', '高中 选必二'].sort());

        const junior = await getNotebookCandidateTags({ subject: 'math', stage: 'junior_high' }, CNM_TAG_SET);
        expect(junior?.tags).toEqual(expect.arrayContaining(['正数和负数', '有理数的加法']));
        expect(junior?.tags).not.toContain('集合的概念');
        const senior = await getNotebookCandidateTags({ subject: 'math', stage: 'senior_high' }, CNM_TAG_SET);
        expect(senior?.tags).toEqual(expect.arrayContaining(['集合的概念', '数列的概念']));

        const again = await (await importTopics({ topics })).json();
        expect(again.result).toMatchObject({ created: 0, skipped: 7 });
        expect(await database.knowledgeTag.count({ where: { tagSet: CNM_TAG_SET } })).toBe(7 + 6 + 6);
    });

    it('旧脚本创建的年级节点改为新名称，保留节点与题目关联', async () => {
        const legacy = await database.knowledgeTag.create({ data: { name: '初一上', subject: 'math', isSystem: true, tagSet: CNM_TAG_SET } });
        const chapter = await database.knowledgeTag.create({ data: { name: '七年级上册 第一章 有理数', subject: 'math', parentId: legacy.id, isSystem: true, tagSet: CNM_TAG_SET } });
        const leaf = await database.knowledgeTag.create({ data: { name: '正数和负数', subject: 'math', parentId: chapter.id, isSystem: true, tagSet: CNM_TAG_SET, code: 'cnm_j001' } });
        const builtIn = await database.knowledgeTag.create({ data: { name: '初一上', subject: 'math', isSystem: true } });

        const body = await (await importTopics({ topics })).json();
        expect(body.result).toMatchObject({ created: 6, skipped: 1 });

        expect(await database.knowledgeTag.findUnique({ where: { id: legacy.id } })).toMatchObject({ name: '七年级上' });
        expect(await database.knowledgeTag.findUnique({ where: { id: leaf.id } })).toMatchObject({ parentId: chapter.id });
        expect(await database.knowledgeTag.findUnique({ where: { id: builtIn.id } })).toMatchObject({ name: '初一上', tagSet: 'default' });
    });
});
