/**
 * /api/analytics API 集成测试
 * 测试分析统计接口
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are initialized before module imports
const mocks = vi.hoisted(() => ({
    mockPrismaErrorItem: {
        count: vi.fn(),
        findMany: vi.fn(),
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
        errorItem: mocks.mockPrismaErrorItem,
        user: { findUnique: vi.fn(async () => ({ masteryThreshold: 50 })) },
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
import { GET } from '@/app/api/analytics/route';
import { getServerSession } from 'next-auth';
import type { Session } from 'next-auth';

describe('/api/analytics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);
    });

    describe('GET /api/analytics (获取分析统计)', () => {
        it('北京时间跨日后使用当天零点到次日零点的统计范围', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-10-18T16:01:00Z'));
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            try {
                const response = await GET();
                expect(response.status).toBe(200);
                expect((await response.json()).activityData.at(-1).date).toBe('10-19');
                expect(mocks.mockPrismaErrorItem.count.mock.calls.at(-1)?.[0].where.createdAt).toEqual({
                    gte: new Date('2026-10-18T16:00:00Z'), lt: new Date('2026-10-19T16:00:00Z'),
                });
            } finally {
                vi.useRealTimers();
            }
        });
        it('应该返回完整的统计数据', async () => {
            // Mock total errors
            mocks.mockPrismaErrorItem.count
                .mockResolvedValueOnce(100)  // totalErrors
                .mockResolvedValueOnce(75);  // masteredCount

            // Mock subject distribution
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([
                { subject: { name: '数学' } },
                { subject: { name: '数学' } },
                { subject: { name: '英语' } },
            ]);

            // Mock activity data (7 days)
            for (let i = 0; i < 7; i++) {
                mocks.mockPrismaErrorItem.count.mockResolvedValueOnce(i + 1);
            }

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.totalErrors).toBe(100);
            expect(data.masteredCount).toBe(75);
            expect(data.masteryRate).toBe('75.0');
            expect(data.subjectStats).toBeDefined();
            expect(data.activityData).toBeDefined();
        });

        it('应该返回正确的学科分布', async () => {
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([
                { subject: { name: '数学' } },
                { subject: { name: '数学' } },
                { subject: { name: '数学' } },
                { subject: { name: '物理' } },
                { subject: { name: '化学' } },
            ]);

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(200);

            const mathStat = data.subjectStats.find((s: { name: string }) => s.name === '数学');
            expect(mathStat).toBeDefined();
            expect(mathStat.value).toBe(3);

            const physicsStat = data.subjectStats.find((s: { name: string }) => s.name === '物理');
            expect(physicsStat).toBeDefined();
            expect(physicsStat.value).toBe(1);
        });

        it('统计学科分布时只读取科目名，不读取原图等大字段', async () => {
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);

            await GET();

            const args = mocks.mockPrismaErrorItem.findMany.mock.calls[0][0];
            expect(args).not.toHaveProperty('include');
            expect(args.select).toEqual({ subject: { select: { name: true } } });
        });

        it('应该处理没有学科的错题', async () => {
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([
                { subject: null },
                { subject: { name: '数学' } },
            ]);

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(200);

            const unknownStat = data.subjectStats.find((s: { name: string }) => s.name === 'Unknown');
            expect(unknownStat).toBeDefined();
            expect(unknownStat.value).toBe(1);
        });

        it('应该返回7天的活动数据', async () => {
            mocks.mockPrismaErrorItem.count.mockResolvedValue(5);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.activityData).toHaveLength(7);
            expect(data.activityData[0]).toHaveProperty('date');
            expect(data.activityData[0]).toHaveProperty('count');
        });

        it('应该处理零错题情况', async () => {
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.totalErrors).toBe(0);
            expect(data.masteredCount).toBe(0);
            expect(data.masteryRate).toBe(0);
        });

        it('应该正确计算掌握率', async () => {
            mocks.mockPrismaErrorItem.count
                .mockResolvedValueOnce(200)  // totalErrors
                .mockResolvedValueOnce(50);  // masteredCount
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.masteryRate).toBe('25.0');
        });

        it('应该拒绝未登录用户', async () => {
            vi.mocked(getServerSession).mockResolvedValue(null);

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Unauthorized');
        });

        it('应该拒绝 session 中没有 user 的请求', async () => {
            vi.mocked(getServerSession).mockResolvedValue({
                user: undefined,
                expires: '2025-12-31',
            } as unknown as Session);

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Unauthorized');
        });

        it('应该处理数据库错误', async () => {
            mocks.mockPrismaErrorItem.count.mockRejectedValue(
                new Error('Database connection failed')
            );

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.message).toBe('Failed to fetch analytics');
        });

        it('应该处理100%掌握率', async () => {
            // 重置 mock
            vi.clearAllMocks();
            vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);

            mocks.mockPrismaErrorItem.count
                .mockResolvedValueOnce(50)   // totalErrors
                .mockResolvedValueOnce(50);  // masteredCount (all mastered)
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);

            // Mock 活动数据
            for (let i = 0; i < 7; i++) {
                mocks.mockPrismaErrorItem.count.mockResolvedValueOnce(0);
            }

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.masteryRate).toBe('100.0');
        });

        it('应该处理0%掌握率', async () => {
            // 重置 mock
            vi.clearAllMocks();
            vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);

            mocks.mockPrismaErrorItem.count
                .mockResolvedValueOnce(50)  // totalErrors
                .mockResolvedValueOnce(0);  // masteredCount (none mastered)
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);

            // Mock 活动数据
            for (let i = 0; i < 7; i++) {
                mocks.mockPrismaErrorItem.count.mockResolvedValueOnce(0);
            }

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.masteryRate).toBe('0.0');
        });
    });
});
