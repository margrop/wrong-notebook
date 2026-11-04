/**
 * /api/stats/weak-tags API 集成测试
 * 测试薄弱知识点排行接口：范围、学科筛选、数据隔离、查询字段
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    mockPrismaErrorItem: {
        findMany: vi.fn(),
    },
    mockPrismaSubject: {
        findFirst: vi.fn(),
    },
    mockPrismaUser: {
        findUnique: vi.fn(),
    },
    mockGetServerSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        errorItem: mocks.mockPrismaErrorItem,
        subject: mocks.mockPrismaSubject,
        user: mocks.mockPrismaUser,
    },
}));

vi.mock('next-auth', () => ({
    getServerSession: mocks.mockGetServerSession,
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

vi.mock('@/lib/config', () => ({ getAppTimeZone: () => 'Asia/Shanghai' }));

import { GET } from '@/app/api/stats/weak-tags/route';

function makeRequest(url: string): Request {
    return new Request(url);
}

describe('/api/stats/weak-tags', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockGetServerSession.mockResolvedValue({
            user: { id: 'user-123', email: 'user@example.com' },
            expires: '2099-01-01',
        });
        mocks.mockPrismaUser.findUnique.mockResolvedValue({ id: 'user-123', email: 'user@example.com', masteryThreshold: 50 });
        mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
        mocks.mockPrismaSubject.findFirst.mockResolvedValue(null);
    });

    it('未登录时返回 401', async () => {
        mocks.mockGetServerSession.mockResolvedValue(null);

        const response = await GET(makeRequest('http://localhost/api/stats/weak-tags'));
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.message).toBe('Authentication required');
        expect(mocks.mockPrismaErrorItem.findMany).not.toHaveBeenCalled();
    });

    it('按用户 ID 查询并只 select 轻字段', async () => {
        const response = await GET(makeRequest('http://localhost/api/stats/weak-tags'));
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.weakTags).toEqual([]);
        expect(data.range).toBe('30d');

        expect(mocks.mockPrismaErrorItem.findMany).toHaveBeenCalledTimes(1);
        const query = mocks.mockPrismaErrorItem.findMany.mock.calls[0][0];
        // 不读题干、图片等大字段
        const selected = Object.keys(query.select).sort();
        expect(selected).toEqual([
            '_count',
            'id',
            'masteryProbability',
            'practiceRecords',
            'subject',
            'subjectId',
            'tags',
        ]);
        // result 非空的总记录数
        expect(query.select._count).toEqual({
            select: { practiceRecords: { where: { result: { not: null } } } },
        });
        // 近 30 天窗口 + 排除 duplicate_import
        expect(query.select.practiceRecords.where.source).toEqual({ not: 'duplicate_import' });
        expect(query.select.practiceRecords.where.result).toEqual({ not: null });
        expect(query.select.practiceRecords.where.createdAt).toEqual({
            gte: expect.any(Date),
            lt: expect.any(Date),
        });
        // 不读题干、图片
        expect(query.select.practiceRecords.select).toEqual({ result: true });
    });

    it('默认 30d 范围按 createdAt 过滤，7d 用更早的起点', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-04T08:00:00Z'));
        try {
            await GET(makeRequest('http://localhost/api/stats/weak-tags'));
            let query = mocks.mockPrismaErrorItem.findMany.mock.calls[0][0];
            // 30d：29 天前的零点（北京时间 2026-10-06 00:00 → UTC 2026-10-05T16:00）
            expect(query.where.createdAt).toEqual({ gte: new Date('2026-10-05T16:00:00Z') });

            vi.clearAllMocks();
            await GET(makeRequest('http://localhost/api/stats/weak-tags?range=7d'));
            query = mocks.mockPrismaErrorItem.findMany.mock.calls[0][0];
            // 7d：6 天前的零点（北京时间 2026-10-29 → UTC 2026-10-28T16:00）
            expect(query.where.createdAt).toEqual({ gte: new Date('2026-10-28T16:00:00Z') });
        } finally {
            vi.useRealTimers();
        }
    });

    it('all 范围不过滤 createdAt', async () => {
        await GET(makeRequest('http://localhost/api/stats/weak-tags?range=all'));
        const query = mocks.mockPrismaErrorItem.findMany.mock.calls[0][0];
        expect(query.where).toEqual({ userId: 'user-123' });
    });

    it('传入合法 subjectId 时按学科筛选，并返回学科信息', async () => {
        mocks.mockPrismaSubject.findFirst.mockResolvedValue({ id: 'sub-1', name: '数学' });
        mocks.mockPrismaErrorItem.findMany.mockResolvedValue([
            {
                id: 'e1',
                subjectId: 'sub-1',
                subject: { name: '数学' },
                masteryProbability: null,
                tags: [{ name: '方程', tagSet: 'default' }],
                _count: { practiceRecords: 0 },
                practiceRecords: [],
            },
        ]);

        const response = await GET(makeRequest('http://localhost/api/stats/weak-tags?subjectId=sub-1'));
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.subjectId).toBe('sub-1');
        expect(data.subjectName).toBe('数学');

        const query = mocks.mockPrismaErrorItem.findMany.mock.calls[0][0];
        expect(query.where).toEqual({
            userId: 'user-123',
            subjectId: 'sub-1',
            createdAt: { gte: expect.any(Date) },
        });

        expect(data.weakTags).toHaveLength(1);
        expect(data.weakTags[0]).toMatchObject({
            tag: '方程',
            tagSet: 'default',
            subjectId: 'sub-1',
            subjectName: '数学',
            total: 1,
            unmastered: 1,
        });
    });

    it('传入不属于当前用户的 subjectId 时当作未筛选', async () => {
        mocks.mockPrismaSubject.findFirst.mockResolvedValue(null);

        await GET(makeRequest('http://localhost/api/stats/weak-tags?subjectId=other-sub'));

        const query = mocks.mockPrismaErrorItem.findMany.mock.calls[0][0];
        expect(query.where).toEqual({
            userId: 'user-123',
            createdAt: { gte: expect.any(Date) },
        });
    });

    it('只查询当前用户的错题（userId 隔离他人数据）', async () => {
        await GET(makeRequest('http://localhost/api/stats/weak-tags'));

        const query = mocks.mockPrismaErrorItem.findMany.mock.calls[0][0];
        expect(query.where.userId).toBe('user-123');
        // 查询条件里没有 OR/AND 之类的跨用户入口
        expect(Object.keys(query.where).sort()).toEqual(['createdAt', 'userId']);
    });

    it('聚合返回排序后的前 10 条且不含已掌握组', async () => {
        const items: unknown[] = Array.from({ length: 12 }, (_, i) => ({
            id: `e${i}`,
            subjectId: 'sub-1',
            subject: { name: '数学' },
            masteryProbability: null,
            tags: [{ name: `标签${i}`, tagSet: 'default' }],
            _count: { practiceRecords: 0 },
            practiceRecords: [],
        }));
        // 全部已掌握的一组
        items.push({
            id: 'mastered',
            subjectId: 'sub-1',
            subject: { name: '数学' },
            masteryProbability: 0.9,
            tags: [{ name: '已掌握标签', tagSet: 'default' }],
            _count: { practiceRecords: 2 },
            practiceRecords: [{ result: 'correct' }],
        });
        mocks.mockPrismaErrorItem.findMany.mockResolvedValue(items);

        const response = await GET(makeRequest('http://localhost/api/stats/weak-tags'));
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.weakTags).toHaveLength(10);
        expect(data.weakTags.every((g: { unmastered: number }) => g.unmastered > 0)).toBe(true);
        expect(data.weakTags.some((g: { tag: string }) => g.tag === '已掌握标签')).toBe(false);
    });

    it('近 30 天记录使用 correct/wrong 口径统计', async () => {
        mocks.mockPrismaErrorItem.findMany.mockResolvedValue([
            {
                id: 'e1',
                subjectId: 'sub-1',
                subject: { name: '数学' },
                masteryProbability: 0.2,
                tags: [{ name: '方程', tagSet: 'default' }],
                _count: { practiceRecords: 4 },
                practiceRecords: [
                    { result: 'correct' },
                    { result: 'wrong' },
                    { result: 'not_attempted' },
                    { result: null },
                ],
            },
        ] as unknown[]);

        const response = await GET(makeRequest('http://localhost/api/stats/weak-tags'));
        const data = await response.json();

        expect(data.weakTags[0].recentAttempted).toBe(2);
        expect(data.weakTags[0].recentCorrect).toBe(1);
        expect(data.weakTags[0].recentErrorRate).toBeCloseTo(0.5, 5);
    });

    it('数据库错误时返回 500', async () => {
        mocks.mockPrismaErrorItem.findMany.mockRejectedValue(new Error('Database connection failed'));

        const response = await GET(makeRequest('http://localhost/api/stats/weak-tags'));
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.message).toBe('Failed to fetch weak tags');
    });
});
