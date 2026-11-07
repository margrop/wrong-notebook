// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ prisma: undefined as PrismaClient | undefined }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { getNotebookCandidateTags } from '@/lib/ai/tag-service';
import { seedUniversityGrades } from '@/lib/tags/seed';
import { UNIVERSITY_GRADES, UNIVERSITY_SUBJECTS } from '@/lib/tags/data/university';

let database: PrismaClient;
let directory: string;

beforeAll(() => {
    // 只在系统临时目录执行迁移和真实数据库读写。
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-university-tags-'));
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } } });
    mocks.prisma = database;
}, 120000);

beforeEach(async () => {
    await database.knowledgeTag.deleteMany();
    await database.user.deleteMany();
});

afterAll(async () => {
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('大学年级根节点', () => {
    it('为每个学科建立大一至大四四个年级节点', async () => {
        const created = await database.$transaction((tx) => seedUniversityGrades(tx));
        expect(created).toBe(UNIVERSITY_GRADES.length * UNIVERSITY_SUBJECTS.length);

        const roots = await database.knowledgeTag.findMany({
            where: { isSystem: true, parentId: null, tagSet: 'default' },
            orderBy: [{ subject: 'asc' }, { order: 'asc' }],
        });
        expect(roots).toHaveLength(created);
        for (const subject of UNIVERSITY_SUBJECTS) {
            expect(roots.filter((tag) => tag.subject === subject).map((tag) => tag.name)).toEqual([...UNIVERSITY_GRADES]);
        }
        expect(roots.every((tag) => tag.order >= 13 && tag.order <= 16)).toBe(true);
    });

    it('没有知识点的年级节点不会被当成候选知识点', async () => {
        await database.$transaction((tx) => seedUniversityGrades(tx));
        const candidates = await getNotebookCandidateTags({ subject: 'math', stage: 'university' });
        expect(candidates).toEqual({ subjectName: '数学', tags: [] });
    });

    it('用户标签不计入系统候选池，其他学段也取不到大学的知识点', async () => {
        await database.$transaction((tx) => seedUniversityGrades(tx, ['math']));
        const freshman = await database.knowledgeTag.findFirstOrThrow({ where: { subject: 'math', name: '大一' } });
        await database.user.create({ data: { id: 'user-1', email: 'university-test@example.com', password: 'test-only' } });
        await database.knowledgeTag.create({
            data: { name: '极限的定义', subject: 'math', isSystem: false, userId: 'user-1', parentId: freshman.id },
        });

        expect(await getNotebookCandidateTags({ subject: 'math', stage: 'university' })).toEqual({ subjectName: '数学', tags: [] });
        expect(await getNotebookCandidateTags({ subject: 'math', stage: 'senior_high' })).toEqual({ subjectName: '数学', tags: [] });
    });

    it('重复执行不新增节点，并把已有节点的顺序对齐', async () => {
        await database.$transaction((tx) => seedUniversityGrades(tx, ['math']));
        await database.knowledgeTag.updateMany({ where: { subject: 'math', name: '大三' }, data: { order: 99 } });

        expect(await database.$transaction((tx) => seedUniversityGrades(tx, ['math']))).toBe(0);
        expect(await database.knowledgeTag.count({ where: { subject: 'math' } })).toBe(UNIVERSITY_GRADES.length);
        expect((await database.knowledgeTag.findFirstOrThrow({ where: { subject: 'math', name: '大三' } })).order).toBe(15);
    });

    it('不覆盖同名但属于其他学段的节点与其他标签体系', async () => {
        await database.knowledgeTag.create({ data: { id: 'subject-tag', name: '大一', subject: 'math', isSystem: true, tagSet: 'other' } });
        const before = await database.knowledgeTag.findUniqueOrThrow({ where: { id: 'subject-tag' } });

        await database.$transaction((tx) => seedUniversityGrades(tx, ['math']));

        expect(await database.knowledgeTag.findUniqueOrThrow({ where: { id: 'subject-tag' } })).toEqual(before);
        expect(await database.knowledgeTag.count({ where: { subject: 'math', name: '大一', tagSet: 'default' } })).toBe(1);
    });
});