/**
 * 今日待复习 API 集成测试
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    errorItem: { findMany: vi.fn() },
    session: { user: { id: 'user-1', email: 'user@example.com' }, expires: '2099-01-01' } as { user: { id: string; email: string }; expires: string } | null,
}));

vi.mock('@/lib/prisma', () => ({ prisma: { errorItem: mocks.errorItem, user: { findUnique: vi.fn(async () => ({ id: 'user-1', masteryThreshold: 50 })) } } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/config', () => ({ getAppTimeZone: () => 'Asia/Shanghai' }));

import { GET } from '@/app/api/review/due/route';

const get = (query = '') => GET(new Request(`http://localhost/api/review/due${query}`));

const candidates = [
    // 录入两天前、没有作答：昨天到期
    { id: 'new', createdAt: new Date('2026-10-18T02:00:00Z'), practiceRecords: [] },
    // 今天刚做对一次：两天后到期
    { id: 'fresh', createdAt: new Date('2026-10-01T02:00:00Z'), practiceRecords: [{ result: 'correct', createdAt: new Date('2026-10-20T01:00:00Z') }] },
    // 很早以前做错：早已到期，应排在最前
    { id: 'old', createdAt: new Date('2026-09-01T02:00:00Z'), practiceRecords: [{ result: 'wrong', createdAt: new Date('2026-09-10T02:00:00Z') }] },
];

describe('GET /api/review/due', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ toFake: ['Date'] });
        // 北京时间 2026-10-20 12:00
        vi.setSystemTime(new Date('2026-10-20T04:00:00Z'));
        mocks.session = { user: { id: 'user-1', email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.errorItem.findMany.mockImplementation(async (args: { where: { id?: { in: string[] } } }) => {
            if (!args.where.id) return candidates;
            return args.where.id.in.map((id) => ({ id, masteryProbability: null, subject: null, tags: [], _count: { practiceRecords: id === 'new' ? 0 : 1 } }));
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('只返回到期的错题，最早到期的在前，并附带复习计划', async () => {
        const response = await get();
        expect(response.status).toBe(200);
        const data = await response.json();

        expect(data.total).toBe(2);
        expect(data.items.map((item: { id: string }) => item.id)).toEqual(['old', 'new']);
        expect(data.items[0]).toMatchObject({ reviewStage: 0, masteryStatus: 'reviewing', nextReviewAt: '2026-09-10T16:00:00.000Z' });
        expect(data.items[1]).toMatchObject({ reviewStage: 0, masteryStatus: 'new' });
        expect(mocks.errorItem.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { userId: 'user-1' } }));
    });

    it('按错题本筛选并分页', async () => {
        const response = await get('?subjectId=math&page=2&pageSize=1');
        const data = await response.json();

        expect(mocks.errorItem.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { userId: 'user-1', subjectId: 'math' } }));
        expect(data).toMatchObject({ total: 2, page: 2, pageSize: 1, totalPages: 2 });
        expect(data.items.map((item: { id: string }) => item.id)).toEqual(['new']);
    });

    it('未登录时返回 401', async () => {
        mocks.session = null;
        const response = await get();
        expect(response.status).toBe(401);
    });

    it('page 或 pageSize 为非数字时返回 400', async () => {
        for (const query of ['?page=abc', '?pageSize=xyz', '?page=-1', '?pageSize=0']) {
            const response = await get(query);
            expect(response.status).toBe(400);
        }
    });
});
