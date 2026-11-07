// @vitest-environment node
/**
 * 打印视图规模回归：单页 id 较多时，Prisma 会拆分带否定条件的查询，
 * 而否定条件（「非内嵌 base64」）无法拆分，错题满 1000 条就会报参数上限、打印预览整页失败。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    session: { user: { id: 'print-user', email: 'print@example.com', role: 'user' }, expires: '2099-01-01' },
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from '@/app/api/error-items/list/route';

/** 一次打印能取到的上限，达到即触发原故障 */
const PAGE_SIZE = 1000;

let database: PrismaClient;
let directory: string;

beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'print-view-scale-'));
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } } });
    mocks.prisma = database;

    await database.user.create({ data: { id: 'print-user', email: 'print@example.com', password: 'test-only' } });
    await database.subject.create({ data: { id: 'math', name: '数学', subjectKey: 'math', stage: 'junior_high', userId: 'print-user' } });
    // 一半内嵌 base64 原图（换成图片接口），一半外部链接（原样返回）
    await database.errorItem.createMany({
        data: Array.from({ length: PAGE_SIZE }, (_, i) => ({
            id: `print-${i}`,
            userId: 'print-user',
            subjectId: 'math',
            originalImageUrl: i % 2 === 0 ? 'data:image/png;base64,dGVzdA==' : `https://example.com/${i}.png`,
            questionText: `题目 ${i}`,
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
        })),
    });
}, 120000);

afterAll(async () => {
    mocks.prisma = undefined;
    await database.$disconnect();
    rmSync(directory, { recursive: true, force: true });
});

const get = (query = '') => GET(new Request(`http://localhost/api/error-items/list?subjectId=math&${query}`));

describe('打印视图达到单页上限时', () => {
    it('一次返回全部 1000 道题，原图按类型分别处理', async () => {
        const response = await get(`view=print&pageSize=${PAGE_SIZE}`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.items).toHaveLength(PAGE_SIZE);

        const byId = new Map<string, { originalImageUrl: string }>(data.items.map((item: { id: string; originalImageUrl: string }) => [item.id, item]));
        // 内嵌 base64 换成懒加载的图片接口
        expect(byId.get('print-0')?.originalImageUrl).toMatch(/^\/api\/error-items\/print-0\/image\?v=\d+$/);
        // 外部链接原样返回，不丢图
        expect(byId.get('print-1')?.originalImageUrl).toBe('https://example.com/1.png');
    });
});