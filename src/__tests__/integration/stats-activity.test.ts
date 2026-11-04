/**
 * /api/stats/activity API 集成测试
 * 测试学习活动热力图数据接口
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are initialized before module imports
const mocks = vi.hoisted(() => ({
    mockPrismaPracticeRecord: {
        findMany: vi.fn(),
    },
    mockPrismaErrorItem: {
        findMany: vi.fn(),
    },
    mockPrismaSubject: {
        findFirst: vi.fn(),
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

// Mock Prisma client
vi.mock('@/lib/prisma', () => ({
    prisma: {
        practiceRecord: mocks.mockPrismaPracticeRecord,
        errorItem: mocks.mockPrismaErrorItem,
        subject: mocks.mockPrismaSubject,
        user: { findUnique: vi.fn(async () => ({ id: 'user-123', email: 'user@example.com' })) },
    },
}));

// Mock next-auth
vi.mock('next-auth', () => ({
    getServerSession: vi.fn(() => Promise.resolve(mocks.mockSession)),
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));
vi.mock('@/lib/config', () => ({ getAppTimeZone: () => 'Asia/Shanghai' }));

// Import after mocks
import { GET as GET_ACTIVITY_STATS } from '@/app/api/stats/activity/route';
import { getServerSession } from 'next-auth';

function makeRequest(url: string): Request {
    return new Request(url);
}

describe('/api/stats/activity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);
    });

    describe('GET /api/stats/activity (获取学习活动统计)', () => {
        it('返回最近 26 周的日期数据和连续天数', async () => {
            // 模拟今天北京时间 2026-11-03
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-11-03T04:00:00Z')); // 北京时间 2026-11-03 12:00

            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);

            const response = await GET_ACTIVITY_STATS(makeRequest('http://localhost/api/stats/activity'));
            const data = await response.json();

            expect(response.status).toBe(200);
            // 26 周 * 7 天 = 182 天
            expect(data.days).toHaveLength(182);
            // 2026-11-03 是周二，所在周的周一是 2026-11-02
            // 26 周前的周一是 2026-05-11
            expect(data.days[0].date).toBe('2026-05-11');
            // 最后一天是 2026-11-08（2026-05-11 + 181 天）
            expect(data.days[181].date).toBe('2026-11-08');
            expect(data.currentStreak).toBe(0);
            expect(data.longestStreak).toBe(0);
            expect(data.totalActiveDays).toBe(0);

            vi.useRealTimers();
        });

        it('正确统计当天录入的错题和练习记录', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-11-03T04:00:00Z')); // 北京时间 2026-11-03 12:00

            // 今天北京时间 2026-11-03 录入了 2 道错题，练习了 3 次
            // UTC 时间：2026-11-02T16:00:00Z 到 2026-11-03T16:00:00Z
            mocks.mockPrismaErrorItem.findMany
                .mockResolvedValueOnce([ // 范围内查询
                    { createdAt: new Date('2026-11-03T01:00:00Z') }, // 北京时间 11-03 09:00
                    { createdAt: new Date('2026-11-03T05:00:00Z') }, // 北京时间 11-03 13:00
                ])
                .mockResolvedValueOnce([ // 全部历史
                    { createdAt: new Date('2026-11-03T01:00:00Z') },
                    { createdAt: new Date('2026-11-03T05:00:00Z') },
                ]);

            mocks.mockPrismaPracticeRecord.findMany
                .mockResolvedValueOnce([ // 范围内查询
                    { createdAt: new Date('2026-11-03T02:00:00Z') },
                    { createdAt: new Date('2026-11-03T03:00:00Z') },
                    { createdAt: new Date('2026-11-03T06:00:00Z') },
                ])
                .mockResolvedValueOnce([ // 全部历史
                    { createdAt: new Date('2026-11-03T02:00:00Z') },
                    { createdAt: new Date('2026-11-03T03:00:00Z') },
                    { createdAt: new Date('2026-11-03T06:00:00Z') },
                ]);

            const response = await GET_ACTIVITY_STATS(makeRequest('http://localhost/api/stats/activity'));
            const data = await response.json();

            expect(response.status).toBe(200);
            // 找到 11-03 的数据
            const todayData = data.days.find((d: { date: string }) => d.date === '2026-11-03');
            expect(todayData).toBeDefined();
            expect(todayData.errors).toBe(2);
            expect(todayData.practices).toBe(3);
            expect(data.currentStreak).toBe(1);
            expect(data.longestStreak).toBe(1);
            expect(data.totalActiveDays).toBe(1);

            vi.useRealTimers();
        });

        it('排除 duplicate_import 来源的练习记录', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-11-03T04:00:00Z'));

            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);

            await GET_ACTIVITY_STATS(makeRequest('http://localhost/api/stats/activity'));

            // 验证练习记录查询条件包含排除 duplicate_import
            const practiceCalls = mocks.mockPrismaPracticeRecord.findMany.mock.calls;
            expect(practiceCalls.length).toBeGreaterThan(0);
            for (const call of practiceCalls) {
                expect(call[0].where.source).toEqual({ not: 'duplicate_import' });
            }

            vi.useRealTimers();
        });

        it('支持学科筛选', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-11-03T04:00:00Z'));

            mocks.mockPrismaSubject.findFirst.mockResolvedValue({ id: 'sub-1', name: '数学' });
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);

            const response = await GET_ACTIVITY_STATS(makeRequest('http://localhost/api/stats/activity?subjectId=sub-1'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.subjectId).toBe('sub-1');
            expect(data.subjectName).toBe('数学');

            // 验证查询条件包含学科筛选
            const errorCalls = mocks.mockPrismaErrorItem.findMany.mock.calls;
            expect(errorCalls[0][0].where.subjectId).toBe('sub-1');
            const practiceCalls = mocks.mockPrismaPracticeRecord.findMany.mock.calls;
            expect(practiceCalls[0][0].where.OR).toBeDefined();

            vi.useRealTimers();
        });

        it('非法 subjectId 当作未筛选', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-11-03T04:00:00Z'));

            mocks.mockPrismaSubject.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);

            const response = await GET_ACTIVITY_STATS(makeRequest('http://localhost/api/stats/activity?subjectId=invalid'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.subjectId).toBeUndefined();

            vi.useRealTimers();
        });

        it('应该拒绝未登录用户', async () => {
            vi.mocked(getServerSession).mockResolvedValue(null);

            const response = await GET_ACTIVITY_STATS(makeRequest('http://localhost/api/stats/activity'));
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Authentication required');
        });

        it('应该处理数据库错误', async () => {
            mocks.mockPrismaErrorItem.findMany.mockRejectedValue(new Error('Database error'));

            const response = await GET_ACTIVITY_STATS(makeRequest('http://localhost/api/stats/activity'));
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.message).toBe('Failed to fetch activity stats');
        });
    });
});
