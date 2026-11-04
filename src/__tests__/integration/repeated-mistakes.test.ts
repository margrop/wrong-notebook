/**
 * /api/stats/repeated-mistakes 集成测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    mockPrismaPracticeRecord: {
        groupBy: vi.fn(),
        findMany: vi.fn(),
    },
    mockPrismaErrorItem: {
        findMany: vi.fn(),
    },
    mockPrismaSubject: {
        findFirst: vi.fn(),
    },
    mockPrismaUser: {
        findUnique: vi.fn(),
    },
    mockSession: {
        user: {
            id: 'user-123',
            email: 'user@example.com',
            name: 'Test User',
        },
        expires: '2025-12-31',
    },
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        practiceRecord: mocks.mockPrismaPracticeRecord,
        errorItem: mocks.mockPrismaErrorItem,
        subject: mocks.mockPrismaSubject,
        user: mocks.mockPrismaUser,
    },
}));

vi.mock('next-auth', () => ({
    getServerSession: vi.fn(() => Promise.resolve(mocks.mockSession)),
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));
vi.mock('@/lib/config', () => ({ getAppTimeZone: () => 'Asia/Shanghai' }));

import { GET } from '@/app/api/stats/repeated-mistakes/route';
import { getServerSession } from 'next-auth';

function makeRequest(url: string): Request {
    return new Request(url);
}

describe('/api/stats/repeated-mistakes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);
        mocks.mockPrismaUser.findUnique.mockResolvedValue({ id: 'user-123', email: 'user@example.com', masteryThreshold: 50 });
    });

    it('应该拒绝未登录用户', async () => {
        vi.mocked(getServerSession).mockResolvedValue(null);

        const response = await GET(makeRequest('http://localhost/api/stats/repeated-mistakes'));
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.message).toBe('Authentication required');
    });

    it('没有出错 2 次以上的错题时返回空列表', async () => {
        mocks.mockPrismaSubject.findFirst.mockResolvedValue(null);
        mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);

        const response = await GET(makeRequest('http://localhost/api/stats/repeated-mistakes'));
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.items).toEqual([]);
        expect(mocks.mockPrismaErrorItem.findMany).not.toHaveBeenCalled();
    });

    it('应该返回出错次数与题干预览，并按次数降序', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
        mocks.mockPrismaSubject.findFirst.mockResolvedValue(null);
        // 第一次 groupBy 统计出错次数，第二次取每题最近一次做错时间
        mocks.mockPrismaPracticeRecord.groupBy
            .mockResolvedValueOnce([
                { errorItemId: 'item-1', _count: { id: 5 } },
                { errorItemId: 'item-2', _count: { id: 3 } },
            ])
            .mockResolvedValueOnce([
                { errorItemId: 'item-1', _max: { createdAt: new Date('2026-11-03T10:00:00Z') } },
                { errorItemId: 'item-2', _max: { createdAt: new Date('2026-11-01T08:00:00Z') } },
            ]);
        mocks.mockPrismaErrorItem.findMany.mockResolvedValue([
            {
                id: 'item-1',
                shortId: 'ABC123',
                questionText: '已知函数 f(x)=x^2，求 f(2) 的值',
                masteryProbability: 0.3,
                subject: { name: '数学' },
                _count: { practiceRecords: 6 },
            },
            {
                id: 'item-2',
                shortId: null,
                questionText: null,
                masteryProbability: 0.8,
                subject: { name: '英语' },
                _count: { practiceRecords: 3 },
            },
        ]);

        try {
            const response = await GET(makeRequest('http://localhost/api/stats/repeated-mistakes'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.items).toHaveLength(2);
            expect(data.items[0]).toMatchObject({
                id: 'item-1',
                shortId: 'ABC123',
                subjectName: '数学',
                preview: '已知函数 f(x)=x^2，求 f(2) 的值',
                wrongCount: 5,
                lastWrongAt: '2026-11-03',
                masteryStatus: 'reviewing',
            });
            expect(data.items[1]).toMatchObject({
                id: 'item-2',
                preview: null,
                wrongCount: 3,
                masteryStatus: 'mastered',
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('题干预览超过 60 字符应截断并加省略号', async () => {
        mocks.mockPrismaSubject.findFirst.mockResolvedValue(null);
        const longText = 'a'.repeat(100);
        mocks.mockPrismaPracticeRecord.groupBy
            .mockResolvedValueOnce([{ errorItemId: 'item-1', _count: { id: 2 } }])
            .mockResolvedValueOnce([{ errorItemId: 'item-1', _max: { createdAt: new Date('2026-11-03T10:00:00Z') } }]);
        mocks.mockPrismaErrorItem.findMany.mockResolvedValue([
            {
                id: 'item-1',
                shortId: null,
                questionText: longText,
                masteryProbability: null,
                subject: null,
                _count: { practiceRecords: 2 },
            },
        ]);

        const response = await GET(makeRequest('http://localhost/api/stats/repeated-mistakes'));
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.items[0].preview).toBe('a'.repeat(60) + '…');
        expect(data.items[0].preview.length).toBe(61);
    });

    it('groupBy 条件包含用户、做错、关联错题、时间与学科筛选', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
        mocks.mockPrismaSubject.findFirst.mockResolvedValue({ id: 'sub-1', name: '数学' });
        mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);

        try {
            await GET(makeRequest('http://localhost/api/stats/repeated-mistakes?range=7d&subjectId=sub-1'));

            expect(mocks.mockPrismaPracticeRecord.groupBy).toHaveBeenCalledTimes(1);
            const call = mocks.mockPrismaPracticeRecord.groupBy.mock.calls[0][0];
            expect(call.by).toEqual(['errorItemId']);
            expect(call.where).toMatchObject({
                userId: 'user-123',
                result: 'wrong',
                errorItemId: { not: null },
                createdAt: { gte: expect.any(Date) },
                errorItem: { subjectId: 'sub-1' },
            });
            expect(call.having).toEqual({ id: { _count: { gte: 2 } } });
            expect(call.orderBy).toEqual({ _count: { id: 'desc' } });
            expect(call.take).toBe(10);
        } finally {
            vi.useRealTimers();
        }
    });

    it('range=all 时不加时间筛选', async () => {
        mocks.mockPrismaSubject.findFirst.mockResolvedValue(null);
        mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);

        await GET(makeRequest('http://localhost/api/stats/repeated-mistakes?range=all'));

        const call = mocks.mockPrismaPracticeRecord.groupBy.mock.calls[0][0];
        expect(call.where.createdAt).toBeUndefined();
    });

    it('非法 subjectId 当作未筛选', async () => {
        mocks.mockPrismaSubject.findFirst.mockResolvedValue(null);
        mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);

        await GET(makeRequest('http://localhost/api/stats/repeated-mistakes?subjectId=other-sub'));

        const call = mocks.mockPrismaPracticeRecord.groupBy.mock.calls[0][0];
        expect(call.where.errorItem).toBeUndefined();
    });

    it('应该处理数据库错误', async () => {
        mocks.mockPrismaSubject.findFirst.mockResolvedValue(null);
        mocks.mockPrismaPracticeRecord.groupBy.mockRejectedValue(new Error('Database error'));

        const response = await GET(makeRequest('http://localhost/api/stats/repeated-mistakes'));
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.message).toBe('Failed to fetch repeated mistakes');
    });
});
