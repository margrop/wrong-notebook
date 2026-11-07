// @vitest-environment node
/**
 * 错题规模回归测试：错题超过 SQLite 单条查询的参数上限（999）时，复习与薄弱知识点接口仍应正常返回。
 *
 * 曾经的写法在嵌套关系里带否定过滤（practiceRecords: { where: { result: { not: null } } }），
 * Prisma 无法按父级 id 把子查询拆成多次执行，父级结果一多就报
 * 「Query parameter limit exceeded」，接口返回 500、今日复习空白。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    session: { user: { id: 'scale-user', email: 'scale@example.com', role: 'user' }, expires: '2099-01-01' },
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/config', () => ({ getAppTimeZone: () => 'Asia/Shanghai' }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { GET as REVIEW_DUE } from '@/app/api/review/due/route';
import { GET as WEAK_TAGS } from '@/app/api/stats/weak-tags/route';

/** 必须超过 SQLite 的 999 参数上限才能复现 */
const ITEM_COUNT = 1200;
const DAY = 24 * 60 * 60 * 1000;

let database: PrismaClient;
let directory: string;
let now: number;

beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-scale-test-'));
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } } });
    mocks.prisma = database;

    now = Date.now();
    await database.user.create({ data: { id: 'scale-user', email: 'scale@example.com', password: 'test-only', masteryThreshold: 50 } });
    await database.subject.create({ data: { id: 'math', name: '数学', stage: 'junior_high', subjectKey: 'math', userId: 'scale-user' } });

    // 1200 道错题，每道都有一次做错记录：全部早已到期，复习页应列出全部
    const ids = Array.from({ length: ITEM_COUNT }, (_, i) => `scale-${i}`);
    const createdAt = new Date(now - 5 * DAY);
    for (let start = 0; start < ids.length; start += 400) {
        const slice = ids.slice(start, start + 400);
        await database.errorItem.createMany({
            data: slice.map((id) => ({ id, userId: 'scale-user', subjectId: 'math', originalImageUrl: '', questionText: id, createdAt })),
        });
        await database.practiceRecord.createMany({
            data: slice.map((id) => ({ userId: 'scale-user', errorItemId: id, result: 'wrong', source: 'practice', createdAt: new Date(now - 3 * DAY) })),
        });
    }

    // 薄弱知识点按标签聚合，至少要有标签才能验证该路径
    await database.knowledgeTag.create({ data: { id: 'tag-algebra', name: '方程', subject: 'math', tagSet: 'default', userId: 'scale-user' } });
    await database.errorItem.update({ where: { id: ids[0] }, data: { tags: { connect: { id: 'tag-algebra' } } } });
    // 一个重复导入产生的记录，薄弱知识点统计不应把它算进近 30 天作答
    await database.practiceRecord.create({
        data: { userId: 'scale-user', errorItemId: ids[0], result: 'wrong', source: 'duplicate_import', createdAt: new Date(now - DAY) },
    });
}, 120000);

afterAll(async () => {
    mocks.prisma = undefined;
    await database.$disconnect();
    rmSync(directory, { recursive: true, force: true });
});

const reviewDue = (query = '') => REVIEW_DUE(new Request(`http://localhost/api/review/due${query}`));
const weakTags = () => WEAK_TAGS(new Request('http://localhost/api/stats/weak-tags'));

describe('错题超过 SQLite 参数上限时', () => {
    it('今日复习仍能列出到期错题，而不是返回 500', async () => {
        const response = await reviewDue();
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.total).toBe(ITEM_COUNT);
        expect(data.items).toHaveLength(18);
        // 每道题都做错过一次，仍停留在第一轮
        expect(data.items[0]).toMatchObject({ reviewStage: 0, masteryStatus: 'reviewing' });
    });

    it('今日复习翻页与按错题本筛选正常', async () => {
        const response = await reviewDue('?page=2&pageSize=100&subjectId=math');
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data).toMatchObject({ total: ITEM_COUNT, page: 2, pageSize: 100 });
        expect(data.items).toHaveLength(100);
        expect(data.totalPages).toBe(12);
    });

    it('薄弱知识点统计仍能返回，并排除重复导入的记录', async () => {
        const response = await weakTags();
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.weakTags).toHaveLength(1);
        // 该标签下有 1 道题；近 30 天只有那条 practice 记录，duplicate_import 不计入
        const [group] = data.weakTags;
        expect(group).toMatchObject({ tag: '方程', total: 1, unmastered: 1, recentAttempted: 1, recentCorrect: 0 });
    });
});