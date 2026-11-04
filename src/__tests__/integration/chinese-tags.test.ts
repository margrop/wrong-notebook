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
import { seedChineseTags } from '@/lib/tags/seed';

let database: PrismaClient;
let directory: string;

beforeAll(() => {
    // 只在系统临时目录执行迁移和真实数据库读写。
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-chinese-tags-'));
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } } });
    mocks.prisma = database;
}, 120000);

beforeEach(async () => {
    await database.errorItem.deleteMany();
    await database.knowledgeTag.deleteMany();
    await database.subject.deleteMany();
    await database.user.deleteMany();
});

afterAll(async () => {
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('语文系统标签增量导入', () => {
    it('全新数据库包含各学段的完整课程，AI 只取得对应学段的知识点', async () => {
        const result = await seedChineseTags(database);
        const tags = await database.knowledgeTag.findMany({ where: { subject: 'chinese', isSystem: true } });
        expect(result).toEqual({ created: tags.length, updated: 0 });
        expect(tags.filter((tag) => tag.parentId === null)).toHaveLength(14);

        const primary = await getNotebookCandidateTags({ subject: 'chinese', stage: 'primary' });
        expect(primary).toMatchObject({ subjectName: '语文' });
        expect(primary?.tags).toEqual(expect.arrayContaining(['声母', '韵母', '看图写话', '习作策略']));
        expect(primary?.tags).not.toContain('一年级');
        expect(primary?.tags).not.toContain('汉语拼音');
        expect(primary?.tags).not.toContain('任务驱动型作文');
        expect(new Set(primary?.tags).size).toBe(primary?.tags.length);

        const junior = await getNotebookCandidateTags({ subject: 'chinese', stage: 'junior_high' });
        expect(junior?.tags).toEqual(expect.arrayContaining(['文言文实词', '朝花夕拾']));
        expect(junior?.tags).not.toContain('声母');
        const senior = await getNotebookCandidateTags({ subject: 'chinese', stage: 'senior_high' });
        expect(senior?.tags).toContain('任务驱动型作文');
        expect(senior?.tags).not.toContain('声母');
    });

    it('升级保留旧标签 ID、题目关联、自定义子节点及其他学科和标签体系', async () => {
        await database.user.create({ data: { id: 'user-1', email: 'chinese-test@example.com', password: 'test-only' } });
        await database.knowledgeTag.create({ data: { id: 'old-grade', name: '七年级', subject: 'chinese', isSystem: true, order: 1 } });
        await database.knowledgeTag.create({ data: { id: 'old-chapter', name: '基础知识', subject: 'chinese', isSystem: true, parentId: 'old-grade', order: 1 } });
        await database.knowledgeTag.create({ data: { id: 'old-leaf', name: '字音字形', subject: 'chinese', isSystem: true, parentId: 'old-chapter', order: 1 } });
        await database.knowledgeTag.create({ data: { id: 'extra', name: '旧版知识点', subject: 'chinese', isSystem: true, parentId: 'old-grade' } });
        await database.knowledgeTag.create({ data: { id: 'custom', name: '我的语文知识点', subject: 'chinese', userId: 'user-1', parentId: 'old-grade' } });
        await database.knowledgeTag.create({ data: { id: 'other-set', name: '一年级', subject: 'chinese', isSystem: true, tagSet: 'other' } });
        await database.knowledgeTag.create({ data: { id: 'math', name: '一年级', subject: 'math', isSystem: true } });
        await database.errorItem.create({
            data: {
                id: 'item-1', userId: 'user-1', questionText: '找出错别字', originalImageUrl: '',
                tags: { connect: ['old-grade', 'old-leaf', 'extra', 'custom', 'other-set', 'math'].map((id) => ({ id })) },
            },
        });
        const itemBefore = await database.errorItem.findUniqueOrThrow({ where: { id: 'item-1' }, include: { tags: { orderBy: { id: 'asc' } } } });
        const untouched = await database.knowledgeTag.findMany({ where: { id: { in: ['extra', 'custom', 'other-set', 'math'] } }, orderBy: { id: 'asc' } });

        await seedChineseTags(database);

        const itemAfter = await database.errorItem.findUniqueOrThrow({ where: { id: 'item-1' }, include: { tags: { orderBy: { id: 'asc' } } } });
        expect(itemAfter.tags.map((tag) => tag.id)).toEqual(itemBefore.tags.map((tag) => tag.id));
        expect(itemAfter.updatedAt).toEqual(itemBefore.updatedAt);
        expect(await database.knowledgeTag.findMany({ where: { id: { in: untouched.map((tag) => tag.id) } }, orderBy: { id: 'asc' } })).toEqual(untouched);
        expect(await database.knowledgeTag.findUniqueOrThrow({ where: { id: 'old-grade' } })).toMatchObject({ name: '七年级', order: 7 });
        expect(await database.knowledgeTag.findMany({ where: { subject: 'chinese', isSystem: true, parentId: 'old-chapter', name: '字音字形' } })).toHaveLength(1);
    });

    it('重复执行不新增重复节点或改写既有数据', async () => {
        await seedChineseTags(database);
        const before = await database.knowledgeTag.findMany({ orderBy: { id: 'asc' } });
        expect(await seedChineseTags(database)).toEqual({ created: 0, updated: 0 });
        expect(await database.knowledgeTag.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    });

    it('中途失败时回滚新增标签和已有排序调整', async () => {
        await database.knowledgeTag.create({ data: { id: 'old-grade', name: '七年级', subject: 'chinese', isSystem: true, order: 1 } });
        const before = await database.knowledgeTag.findMany();
        await database.$executeRaw`CREATE TRIGGER fail_chinese_seed BEFORE INSERT ON "KnowledgeTag"
            WHEN NEW.name = '文言文实词' BEGIN SELECT RAISE(ABORT, '测试导入失败'); END;`;
        try {
            await expect(seedChineseTags(database)).rejects.toThrow();
            expect(await database.knowledgeTag.findMany()).toEqual(before);
        } finally {
            await database.$executeRaw`DROP TRIGGER fail_chinese_seed`;
        }
    });
});
