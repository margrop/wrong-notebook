/**
 * /api/stats API 集成测试
 * 测试练习统计和数据清除接口
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are initialized before module imports
const mocks = vi.hoisted(() => ({
    mockPrismaUser: {
        findUnique: vi.fn(),
    },
    mockPrismaPracticeRecord: {
        groupBy: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        deleteMany: vi.fn(),
        findFirst: vi.fn(),
    },
    mockPrismaErrorItem: {
        deleteMany: vi.fn(),
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
        user: mocks.mockPrismaUser,
        practiceRecord: mocks.mockPrismaPracticeRecord,
        errorItem: mocks.mockPrismaErrorItem,
        subject: mocks.mockPrismaSubject,
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

function makeRequest(url: string): Request {
    return new Request(url);
}

describe('/api/stats', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);
        mocks.mockPrismaUser.findUnique.mockResolvedValue({
            id: 'user-123',
            email: 'user@example.com',
            name: 'Test User',
            masteryThreshold: 50,
        });
    });

    describe('GET /api/stats/practice (获取练习统计)', () => {
        it('默认返回 30 天范围的数据', async () => {
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.range).toBe('30d');
            expect(data.granularity).toBe('day');
            expect(data.activityStats).toHaveLength(30);
            expect(data.activeDays).toBe(0);
        });

        it('支持 range=7d 参数', async () => {
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice?range=7d'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.range).toBe('7d');
            expect(data.granularity).toBe('day');
            expect(data.activityStats).toHaveLength(7);
        });

        it('支持 range=6m 参数', async () => {
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice?range=6m'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.range).toBe('6m');
            expect(data.granularity).toBe('month');
            expect(data.activityStats).toHaveLength(6);
        });

        it('支持 range=all 参数', async () => {
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue({ createdAt: new Date('2025-06-15T00:00:00Z') });
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice?range=all'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.range).toBe('all');
            expect(data.granularity).toBe('month');
            expect(data.activityStats.length).toBeGreaterThan(1);
            expect(data.activityStats[0].date).toBe('2025-06');
        });

        it('非法 range 参数回落默认 30d', async () => {
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice?range=invalid'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.range).toBe('30d');
            expect(data.granularity).toBe('day');
            expect(data.activityStats).toHaveLength(30);
        });

        it('给定合法 subjectId 时只统计该学科', async () => {
            mocks.mockPrismaSubject.findFirst.mockResolvedValue({ id: 'sub-1', name: '数学' });
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue({ createdAt: new Date('2026-10-01T00:00:00Z') });
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany
                .mockResolvedValueOnce([
                    { subject: '数学', errorItem: null },
                ])
                .mockResolvedValueOnce([
                    { createdAt: new Date('2026-10-15T04:00:00Z'), result: 'correct', isCorrect: true, difficulty: 'easy' },
                ]);
            mocks.mockPrismaPracticeRecord.count
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(1);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice?subjectId=sub-1'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.overallStats.total).toBe(1);
            expect(data.subjectId).toBe('sub-1');
            expect(data.subjectName).toBe('数学');
            expect(data.subjectStats[0].name).toBe('数学');
        });

        it('给定非法 subjectId（不属于当前用户）时当作未筛选', async () => {
            mocks.mockPrismaSubject.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany
                .mockResolvedValueOnce([
                    { subject: '数学', errorItem: null },
                    { subject: '英语', errorItem: null },
                ])
                .mockResolvedValueOnce([]);
            mocks.mockPrismaPracticeRecord.count
                .mockResolvedValueOnce(2)
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(2);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice?subjectId=other-sub'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.subjectId).toBeUndefined();
            expect(data.subjectStats).toHaveLength(2);
            expect(data.overallStats.total).toBe(2);
        });

        it('给定合法 subjectId 时查询条件包含关联错题学科或快照匹配', async () => {
            mocks.mockPrismaSubject.findFirst.mockResolvedValue({ id: 'sub-1', name: '数学' });
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue({ createdAt: new Date('2026-10-01T00:00:00Z') });
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);

            await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice?subjectId=sub-1&range=all'));

            // 验证 findMany 调用包含学科筛选条件
            const findManyCall = mocks.mockPrismaPracticeRecord.findMany.mock.calls[0][0];
            expect(findManyCall.where).toMatchObject({
                userId: 'user-123',
                OR: [
                    { errorItem: { subjectId: 'sub-1' } },
                    { errorItem: null, subject: '数学' },
                ],
            });
        });

        it('回归：带 subjectId 时 correct/attempted 的 count 必须同时包含学科条件和结果条件', async () => {
            mocks.mockPrismaSubject.findFirst.mockResolvedValue({ id: 'sub-1', name: '数学' });
            // 非 all 范围不应触发 findFirst 查询最早记录
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);

            await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice?subjectId=sub-1'));

            // 非 all 范围不应查最早记录
            expect(mocks.mockPrismaPracticeRecord.findFirst).not.toHaveBeenCalled();

            // 3 次 count：total、correct、attempted
            expect(mocks.mockPrismaPracticeRecord.count).toHaveBeenCalledTimes(3);
            const countCalls = mocks.mockPrismaPracticeRecord.count.mock.calls;
            // total：不含结果条件
            expect(countCalls[0][0].where).toMatchObject({
                userId: 'user-123',
                OR: [
                    { errorItem: { subjectId: 'sub-1' } },
                    { errorItem: null, subject: '数学' },
                ],
            });
            expect(countCalls[0][0].where.AND).toBeUndefined();
            // correct/attempted：用 AND 组合，同时含学科筛选与结果条件
            for (const idx of [1, 2]) {
                const where = countCalls[idx][0].where;
                expect(where.AND).toBeDefined();
                expect(where.AND).toHaveLength(2);
                // AND 的第一项是 scopedWhere（含学科 OR）
                expect(where.AND[0]).toMatchObject({
                    userId: 'user-123',
                    OR: [
                        { errorItem: { subjectId: 'sub-1' } },
                        { errorItem: null, subject: '数学' },
                    ],
                });
                // AND 的第二项是 CORRECT/ATTEMPTED 条件（含 OR）
                expect(where.AND[1].OR).toBeDefined();
            }
            // correct 的 OR 第一项为 result: 'correct'
            expect(countCalls[1][0].where.AND[1].OR[0]).toEqual({ result: 'correct' });
            // attempted 的 OR 第一项为 result: { in: ['correct', 'wrong'] }
            expect(countCalls[2][0].where.AND[1].OR[0]).toEqual({ result: { in: ['correct', 'wrong'] } });
        });

        it('按北京时间归属月份，月末 UTC 时间正确计入下个月', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-09-30T16:30:00Z'));
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            // findMany 第一次：学科分布；第二次：范围内活动
            mocks.mockPrismaPracticeRecord.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ createdAt: new Date('2026-09-30T16:01:00Z'), result: 'correct', isCorrect: true, difficulty: 'medium' }]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);
            try {
                const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice?range=6m'));
                expect(response.status).toBe(200);
                expect((await response.json()).activityStats.at(-1)).toMatchObject({ date: '2026-10', total: 1, correct: 1 });
            } finally {
                vi.useRealTimers();
            }
        });

        it('应该排除 duplicate_import 来源的记录', async () => {
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValueOnce([
                { difficulty: 'medium', _count: { id: 5 } },
            ]);
            mocks.mockPrismaPracticeRecord.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([
                    { createdAt: new Date(), result: 'correct', isCorrect: true, difficulty: 'medium' },
                ]);
            mocks.mockPrismaPracticeRecord.count
                .mockResolvedValueOnce(8)
                .mockResolvedValueOnce(5)
                .mockResolvedValueOnce(5);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice'));
            expect(response.status).toBe(200);

            // 所有查询都应包含排除 duplicate_import 的条件
            expect(mocks.mockPrismaPracticeRecord.groupBy).toHaveBeenCalledTimes(1);
            for (const call of mocks.mockPrismaPracticeRecord.groupBy.mock.calls) {
                expect(call[0].where.source).toEqual({ not: 'duplicate_import' });
            }
            expect(mocks.mockPrismaPracticeRecord.findMany).toHaveBeenCalledTimes(2);
            for (const call of mocks.mockPrismaPracticeRecord.findMany.mock.calls) {
                expect(call[0].where.source).toEqual({ not: 'duplicate_import' });
            }
            expect(mocks.mockPrismaPracticeRecord.count).toHaveBeenCalledTimes(3);
            for (const call of mocks.mockPrismaPracticeRecord.count.mock.calls) {
                const where = call[0].where;
                // total 的 source 在顶层；correct/attempted 的 source 在 AND[0]（scopedWhere）中
                if (where.AND) {
                    expect(where.AND[0].source).toEqual({ not: 'duplicate_import' });
                } else {
                    expect(where.source).toEqual({ not: 'duplicate_import' });
                }
            }
        });

        it('应该返回练习统计数据', async () => {
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            // groupBy 现在仅按 difficulty 调用一次
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValueOnce([
                { difficulty: 'easy', _count: { id: 3 } },
                { difficulty: 'medium', _count: { id: 7 } },
                { difficulty: 'hard', _count: { id: 5 } },
            ]);

            // findMany 第一次：学科分布；第二次：活动统计
            mocks.mockPrismaPracticeRecord.findMany
                .mockResolvedValueOnce([
                    { subject: '数学', errorItem: null },
                    { subject: '英语', errorItem: null },
                ])
                .mockResolvedValueOnce([
                    { createdAt: new Date(), result: 'correct', isCorrect: true, difficulty: 'medium' },
                    { createdAt: new Date(), result: 'wrong', isCorrect: false, difficulty: 'hard' },
                ]);

            // Mock total and correct counts
            mocks.mockPrismaPracticeRecord.count
                .mockResolvedValueOnce(15)
                .mockResolvedValueOnce(10)
                .mockResolvedValueOnce(12);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.subjectStats).toBeDefined();
            expect(data.activityStats).toBeDefined();
            expect(data.difficultyStats).toBeDefined();
            expect(data.overallStats).toBeDefined();
            expect(data.activeDays).toBeDefined();
        });

        it('应该返回正确的学科分布', async () => {
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany
                .mockResolvedValueOnce([
                    { subject: '数学', errorItem: null },
                    { subject: '数学', errorItem: null },
                ])
                .mockResolvedValueOnce([]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.subjectStats[0].name).toBe('数学');
            expect(data.subjectStats[0].value).toBe(2);
        });

        it('错题学科改名后，学科分布应显示新的学科名', async () => {
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany
                .mockResolvedValueOnce([
                    // 关联的错题学科已改名为「初中数学」，快照仍是旧名「数学」
                    { subject: '数学', errorItem: { subject: { name: '初中数学' } } },
                    { subject: '英语', errorItem: { subject: { name: '初中英语' } } },
                ])
                .mockResolvedValueOnce([]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice'));
            const data = await response.json();

            expect(response.status).toBe(200);
            const names = data.subjectStats.map((s: { name: string }) => s.name);
            expect(names).toContain('初中数学');
            expect(names).toContain('初中英语');
            expect(names).not.toContain('数学');
            expect(names).not.toContain('英语');
            const math = data.subjectStats.find((s: { name: string }) => s.name === '初中数学');
            expect(math.value).toBe(1);
        });

        it('无关联错题时，学科分布应回退到记录快照', async () => {
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany
                .mockResolvedValueOnce([
                    { subject: '物理', errorItem: null },
                    // 关联错题没有学科时也回退到快照
                    { subject: '化学', errorItem: { subject: null } },
                ])
                .mockResolvedValueOnce([]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice'));
            const data = await response.json();

            expect(response.status).toBe(200);
            const stats = Object.fromEntries(data.subjectStats.map((s: { name: string, value: number }) => [s.name, s.value]));
            expect(stats['物理']).toBe(1);
            expect(stats['化学']).toBe(1);
        });

        it('既无关联错题学科也无快照时，学科分布应为 Unknown', async () => {
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany
                .mockResolvedValueOnce([
                    { subject: null, errorItem: null },
                    { subject: null, errorItem: { subject: null } },
                ])
                .mockResolvedValueOnce([]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.subjectStats).toHaveLength(1);
            expect(data.subjectStats[0].name).toBe('Unknown');
            expect(data.subjectStats[0].value).toBe(2);
        });

        it('应该返回正确的正确率', async () => {
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.count
                .mockResolvedValueOnce(100) // total
                .mockResolvedValueOnce(75)  // correct
                .mockResolvedValueOnce(80); // attempted

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.overallStats.total).toBe(100);
            expect(data.overallStats.correct).toBe(75);
            expect(data.overallStats.attempted).toBe(80);
            expect(data.overallStats.rate).toBe('93.8');
        });

        it('应该处理零记录情况', async () => {
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.overallStats.total).toBe(0);
            expect(data.overallStats.rate).toBe(0);
            expect(data.activeDays).toBe(0);
        });

        it('应该排除 not_attempted 记录，不将其计入已作答', async () => {
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.count
                .mockResolvedValueOnce(10) // total
                .mockResolvedValueOnce(6)  // correct
                .mockResolvedValueOnce(8); // attempted（排除了 2 条 not_attempted）

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.overallStats.total).toBe(10);
            expect(data.overallStats.correct).toBe(6);
            expect(data.overallStats.attempted).toBe(8);
            expect(data.overallStats.rate).toBe('75.0');
        });

        it('应该将 result 为 null 且 isCorrect 非空的旧记录视为已作答', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-10-18T12:00:00Z')); // 北京时间 2026-10-18 20:00
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            mocks.mockPrismaPracticeRecord.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([
                    { createdAt: new Date(), result: null, isCorrect: true, difficulty: 'easy' },
                    { createdAt: new Date(), result: null, isCorrect: false, difficulty: 'hard' },
                ]);
            mocks.mockPrismaPracticeRecord.count
                .mockResolvedValueOnce(10) // total
                .mockResolvedValueOnce(6)  // correct
                .mockResolvedValueOnce(8); // attempted（包含 2 条 result=null 的旧记录）

            try {
                const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice?range=6m'));
                const data = await response.json();

                expect(response.status).toBe(200);
                expect(data.overallStats.total).toBe(10);
                expect(data.overallStats.correct).toBe(6);
                expect(data.overallStats.attempted).toBe(8);
                expect(data.overallStats.rate).toBe('75.0');
                // 月度趋势：result=null 且 isCorrect=true 计入 correct
                const monthData = data.activityStats.find((m: { date: string }) => m.date === '2026-10');
                expect(monthData.total).toBe(2);
                expect(monthData.correct).toBe(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('应该计算活跃天数（范围内有练习的不同日期数）', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-10-18T12:00:00Z')); // 北京时间 2026-10-18 20:00
            mocks.mockPrismaPracticeRecord.findFirst.mockResolvedValue(null);
            mocks.mockPrismaPracticeRecord.groupBy.mockResolvedValue([]);
            // 三条记录分别在 10-16、10-17、10-17（北京时间）
            mocks.mockPrismaPracticeRecord.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([
                    { createdAt: new Date('2026-10-15T16:30:00Z'), result: 'correct', isCorrect: true, difficulty: 'easy' },   // 北京时间 10-16 00:30
                    { createdAt: new Date('2026-10-16T10:00:00Z'), result: 'wrong', isCorrect: false, difficulty: 'hard' },   // 北京时间 10-16 18:00
                    { createdAt: new Date('2026-10-17T03:00:00Z'), result: 'correct', isCorrect: true, difficulty: 'medium' }, // 北京时间 10-17 11:00
                ]);
            mocks.mockPrismaPracticeRecord.count.mockResolvedValue(0);
            try {
                const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice?range=7d'));
                const data = await response.json();
                expect(response.status).toBe(200);
                // 活跃天数为 3：10-16、10-17、10-18（三条记录分别落在 10-16、10-16、10-17）
                // 等等，10-16 有两条，10-17 有一条，所以活跃天数是 2
                expect(data.activeDays).toBe(2);
            } finally {
                vi.useRealTimers();
            }
        });

        it('应该拒绝未登录用户', async () => {
            vi.mocked(getServerSession).mockResolvedValue(null);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice'));
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Authentication required');
        });

        it('应该拒绝 session 中没有 user 的请求', async () => {
            vi.mocked(getServerSession).mockResolvedValue({
                user: undefined,
                expires: '2025-12-31',
            } as unknown as Session);

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice'));
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Authentication required');
        });

        it('应该处理数据库错误', async () => {
            // 非 all 范围下不会查询最早记录，让 groupBy 失败触发 500
            mocks.mockPrismaPracticeRecord.groupBy.mockRejectedValue(
                new Error('Database connection failed')
            );

            const response = await GET_PRACTICE_STATS(makeRequest('http://localhost/api/stats/practice'));
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
            expect(data.message).toBe('Authentication required');
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
            expect(data.message).toBe('Authentication required');
        });

        it('应该拒绝 session 中没有 user 的请求', async () => {
            vi.mocked(getServerSession).mockResolvedValue({
                user: undefined,
                expires: '2025-12-31',
            } as unknown as Session);


            const response = await DELETE_ERROR_ITEMS();
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Authentication required');
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
