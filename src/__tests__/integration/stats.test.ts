/**
 * /api/stats API 集成测试
 * 测试练习统计和数据清除接口
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are initialized before module imports
const mocks = vi.hoisted(() => ({
    mockPrismaPracticeRecord: {
        groupBy: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        deleteMany: vi.fn(),
    },
    mockPrismaErrorItem: {
        deleteMany: vi.fn(),
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
import { GET as GET_PRACTICE_STATS } from '@/app/api/stats/practice/route';
import { DELETE as DELETE_PRACTICE_STATS } from '@/app/api/stats/practice/clear/route';
import { DELETE as DELETE_ERROR_ITEMS } from '@/app/api/error-items/clear/route';
import { getServerSession } from 'next-auth';
import type { Session } from 'next-auth';

describe('/api/stats', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);
    });

    describe('GET /api/stats/practice (获取练习统计)', () => {
        it('按北京时间归属月份，月末 UTC 时间正确计入下个月', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-09-30T16:30:00Z'));
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([{ createdAt: new Date('2026-09-30T16:01:00Z'), result: 'correct', isCorrect: true, difficulty: 'medium' }]);
            try {
                const response = await GET_PRACTICE_STATS();
                expect(response.status).toBe(200);
                expect((await response.json()).activityStats.at(-1)).toMatchObject({ date: '2026-10', total: 1, correct: 1 });
                expect(mocks.mockPrismaPracticeRecord.findMany.mock.calls[0][0].where.createdAt.gte.toISOString()).toBe('2026-04-30T16:00:00.000Z');
            } finally {
                vi.useRealTimers();
            }
        });
        it('应该排除 duplicate_import 来源的记录', async () => {
            mocks.mockPrismaPracticeRecord.groupBy
                .mockResolvedValueOnce([
                    { subject: '数学', _count: { id: 8 } },
                ])
                .mockResolvedValueOnce([
                    { difficulty: 'medium', _count: { id: 5 } },
                ]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([
                { createdAt: new Date(), result: 'correct', isCorrect: true, difficulty: 'medium' },
            ]);
            mocks.mockPrismaPracticeRecord.count
                .mockResolvedValueOnce(8)
                .mockResolvedValueOnce(5)
                .mockResolvedValueOnce(5);

            const response = await GET_PRACTICE_STATS();
            expect(response.status).toBe(200);

            // 所有查询都应包含排除 duplicate_import 的条件
            expect(mocks.mockPrismaPracticeRecord.groupBy).toHaveBeenCalledTimes(2);
            for (const call of mocks.mockPrismaPracticeRecord.groupBy.mock.calls) {
                expect(call[0].where.source).toEqual({ not: 'duplicate_import' });
            }
            expect(mocks.mockPrismaPracticeRecord.findMany.mock.calls[0][0].where.source).toEqual({ not: 'duplicate_import' });
            expect(mocks.mockPrismaPracticeRecord.count).toHaveBeenCalledTimes(3);
            for (const call of mocks.mockPrismaPracticeRecord.count.mock.calls) {
                expect(call[0].where.source).toEqual({ not: 'duplicate_import' });
            }
        });

        it('应该返回练习统计数据', async () => {
            // groupBy 被调用两次（subject + difficulty），按调用顺序 mock
            mocks.mockPrismaPracticeRecord.groupBy
                .mockResolvedValueOnce([
                    { subject: '数学', _count: { id: 10 } },
                    { subject: '英语', _count: { id: 5 } },
                ])
                .mockResolvedValueOnce([
                    { difficulty: 'easy', _count: { id: 3 } },
                    { difficulty: 'medium', _count: { id: 7 } },
                    { difficulty: 'hard', _count: { id: 5 } },
                ]);

            // Mock activity stats
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([
                { createdAt: new Date(), result: 'correct', isCorrect: true, difficulty: 'medium' },
                { createdAt: new Date(), result: 'wrong', isCorrect: false, difficulty: 'hard' },
            ]);

            // Mock total and correct counts
            mocks.mockPrismaPracticeRecord.count
                .mockResolvedValueOnce(15)
                .mockResolvedValueOnce(10)
                .mockResolvedValueOnce(12);

            const response = await GET_PRACTICE_STATS();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.subjectStats).toBeDefined();
            expect(data.activityStats).toBeDefined();
            expect(data.difficultyStats).toBeDefined();
            expect(data.overallStats).toBeDefined();
        });

        it('应该返回正确的学科分布', async () => {
            mocks.mockPrismaPracticeRecord.groupBy
                .mockResolvedValueOnce([
                    { subject: '数学', _count: { id: 20 } },
                ])
                .mockResolvedValueOnce([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);

            const response = await GET_PRACTICE_STATS();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.subjectStats[0].name).toBe('数学');
            expect(data.subjectStats[0].value).toBe(20);
        });

        it('应该返回正确的正确率', async () => {
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.count
                .mockResolvedValueOnce(100) // total
                .mockResolvedValueOnce(75)  // correct
                .mockResolvedValueOnce(80); // attempted

            const response = await GET_PRACTICE_STATS();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.overallStats.total).toBe(100);
            expect(data.overallStats.correct).toBe(75);
            expect(data.overallStats.attempted).toBe(80);
            expect(data.overallStats.rate).toBe('93.8');
        });

        it('应该处理零记录情况', async () => {
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);

            const response = await GET_PRACTICE_STATS();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.overallStats.total).toBe(0);
            expect(data.overallStats.rate).toBe(0);
        });

        it('应该排除 not_attempted 记录，不将其计入已作答', async () => {
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.count
                .mockResolvedValueOnce(10) // total
                .mockResolvedValueOnce(6)  // correct
                .mockResolvedValueOnce(8); // attempted（排除了 2 条 not_attempted）

            const response = await GET_PRACTICE_STATS();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.overallStats.total).toBe(10);
            expect(data.overallStats.correct).toBe(6);
            expect(data.overallStats.attempted).toBe(8);
            expect(data.overallStats.rate).toBe('75.0');
        });

        it('应该将 result 为 null 且 isCorrect 非空的旧记录视为已作答', async () => {
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([
                { createdAt: new Date(), result: null, isCorrect: true, difficulty: 'easy' },
                { createdAt: new Date(), result: null, isCorrect: false, difficulty: 'hard' },
            ]);
            mocks.mockPrismaPracticeRecord.count
                .mockResolvedValueOnce(10) // total
                .mockResolvedValueOnce(6)  // correct
                .mockResolvedValueOnce(8); // attempted（包含 2 条 result=null 的旧记录）

            const response = await GET_PRACTICE_STATS();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.overallStats.total).toBe(10);
            expect(data.overallStats.correct).toBe(6);
            expect(data.overallStats.attempted).toBe(8);
            expect(data.overallStats.rate).toBe('75.0');
            // 月度趋势：result=null 且 isCorrect=true 计入 correct
            const currentMonth = new Date().toISOString().slice(0, 7);
            const monthData = data.activityStats.find((m: { date: string }) => m.date === currentMonth);
            expect(monthData.total).toBe(2);
            expect(monthData.correct).toBe(1);
        });

        it('应该拒绝未登录用户', async () => {
            vi.mocked(getServerSession).mockResolvedValue(null);

            const response = await GET_PRACTICE_STATS();
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Unauthorized');
        });

        it('应该拒绝 session 中没有 user 的请求', async () => {
            vi.mocked(getServerSession).mockResolvedValue({
                user: undefined,
                expires: '2025-12-31',
            } as unknown as Session);

            const response = await GET_PRACTICE_STATS();
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Unauthorized');
        });

        it('应该处理数据库错误', async () => {
            mocks.mockPrismaPracticeRecord.groupBy.mockRejectedValue(
                new Error('Database connection failed')
            );

            const response = await GET_PRACTICE_STATS();
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.message).toBe('Failed to fetch stats');
        });
    });

    describe('DELETE /api/stats/practice/clear (清除练习记录)', () => {
        it('应该成功清除练习记录', async () => {
            mocks.mockPrismaPracticeRecord.deleteMany.mockResolvedValue({ count: 50 });


            const response = await DELETE_PRACTICE_STATS();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.message).toBe('Practice history cleared successfully');
            expect(data.count).toBe(50);
        });

        it('应该返回清除的记录数量', async () => {
            mocks.mockPrismaPracticeRecord.deleteMany.mockResolvedValue({ count: 100 });


            const response = await DELETE_PRACTICE_STATS();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.count).toBe(100);
        });

        it('应该处理没有记录的情况', async () => {
            mocks.mockPrismaPracticeRecord.deleteMany.mockResolvedValue({ count: 0 });


            const response = await DELETE_PRACTICE_STATS();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.count).toBe(0);
        });

        it('应该拒绝未登录用户', async () => {
            vi.mocked(getServerSession).mockResolvedValue(null);


            const response = await DELETE_PRACTICE_STATS();
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Unauthorized');
        });

        it('应该处理数据库错误', async () => {
            mocks.mockPrismaPracticeRecord.deleteMany.mockRejectedValue(
                new Error('Database error')
            );


            const response = await DELETE_PRACTICE_STATS();
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.message).toBe('Failed to clear stats');
        });
    });

    describe('DELETE /api/error-items/clear (清除所有错题)', () => {
        it('应该成功清除所有错题', async () => {
            mocks.mockPrismaErrorItem.deleteMany.mockResolvedValue({ count: 30 });


            const response = await DELETE_ERROR_ITEMS();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.message).toBe('Error data cleared successfully');
        });

        it('应该只清除当前用户的错题', async () => {
            mocks.mockPrismaErrorItem.deleteMany.mockResolvedValue({ count: 10 });


            await DELETE_ERROR_ITEMS();

            expect(mocks.mockPrismaErrorItem.deleteMany).toHaveBeenCalledWith({
                where: { userId: 'user-123' },
            });
        });

        it('应该拒绝未登录用户', async () => {
            vi.mocked(getServerSession).mockResolvedValue(null);


            const response = await DELETE_ERROR_ITEMS();
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Unauthorized');
        });

        it('应该拒绝 session 中没有 user 的请求', async () => {
            vi.mocked(getServerSession).mockResolvedValue({
                user: undefined,
                expires: '2025-12-31',
            } as unknown as Session);


            const response = await DELETE_ERROR_ITEMS();
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Unauthorized');
        });

        it('应该处理数据库错误', async () => {
            mocks.mockPrismaErrorItem.deleteMany.mockRejectedValue(
                new Error('Database error')
            );


            const response = await DELETE_ERROR_ITEMS();
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.message).toBe('Failed to clear error data');
        });
    });
});
