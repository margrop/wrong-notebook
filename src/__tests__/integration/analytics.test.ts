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
        groupBy: vi.fn(),
        findFirst: vi.fn(),
    },
    mockPrismaSubject: {
        findMany: vi.fn(),
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
        errorItem: mocks.mockPrismaErrorItem,
        subject: mocks.mockPrismaSubject,
        user: { findUnique: vi.fn(async () => ({ id: 'user-123', email: 'user@example.com', masteryThreshold: 50 })) },
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

function makeRequest(url: string): Request {
    return new Request(url);
}

describe('/api/analytics', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);
    });

    describe('GET /api/analytics (获取分析统计)', () => {
        it('默认返回 30 天范围的数据', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.range).toBe('30d');
            expect(data.granularity).toBe('day');
            expect(data.activityData).toHaveLength(30);
        });

        it('支持 range=7d 参数', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics?range=7d'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.range).toBe('7d');
            expect(data.granularity).toBe('day');
            expect(data.activityData).toHaveLength(7);
        });

        it('支持 range=6m 参数', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics?range=6m'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.range).toBe('6m');
            expect(data.granularity).toBe('month');
            expect(data.activityData).toHaveLength(6);
        });

        it('支持 range=all 参数', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue({ createdAt: new Date('2025-06-15T00:00:00Z') });
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics?range=all'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.range).toBe('all');
            expect(data.granularity).toBe('month');
            // 从 2025-06 到当前月（2026-10）共 17 个月
            expect(data.activityData.length).toBeGreaterThan(1);
            expect(data.activityData[0].date).toBe('2025-06');
        });

        it('非法 range 参数回落默认 30d', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics?range=invalid'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.range).toBe('30d');
            expect(data.granularity).toBe('day');
            expect(data.activityData).toHaveLength(30);
        });

        it('给定合法 subjectId 时只统计该学科', async () => {
            mocks.mockPrismaSubject.findFirst.mockResolvedValue({ id: 'sub-1', name: '数学' });
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue({ createdAt: new Date('2026-10-01T00:00:00Z') });
            mocks.mockPrismaErrorItem.count
                .mockResolvedValueOnce(5)   // totalErrors
                .mockResolvedValueOnce(1)   // newCount
                .mockResolvedValueOnce(2)   // reviewingCount
                .mockResolvedValueOnce(2);  // masteredCount
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([
                { subjectId: 'sub-1', _count: { id: 5 } },
            ]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([
                { id: 'sub-1', name: '数学' },
            ]);

            const response = await GET(makeRequest('http://localhost/api/analytics?subjectId=sub-1'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.totalErrors).toBe(5);
            expect(data.subjectId).toBe('sub-1');
            expect(data.subjectName).toBe('数学');
        });

        it('给定非法 subjectId（不属于当前用户）时当作未筛选', async () => {
            mocks.mockPrismaSubject.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count
                .mockResolvedValueOnce(10)  // totalErrors
                .mockResolvedValueOnce(2)   // newCount
                .mockResolvedValueOnce(3)   // reviewingCount
                .mockResolvedValueOnce(5);  // masteredCount
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([
                { subjectId: 'sub-1', _count: { id: 3 } },
                { subjectId: 'sub-2', _count: { id: 2 } },
            ]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([
                { id: 'sub-1', name: '数学' },
                { id: 'sub-2', name: '英语' },
            ]);

            const response = await GET(makeRequest('http://localhost/api/analytics?subjectId=other-sub'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.totalErrors).toBe(10);
            expect(data.subjectId).toBeUndefined();
            // 学科分布包含多个学科，说明没有按学科筛选
            expect(data.subjectStats).toHaveLength(2);
        });

        it('给定合法 subjectId 时查询条件包含该学科', async () => {
            mocks.mockPrismaSubject.findFirst.mockResolvedValue({ id: 'sub-1', name: '数学' });
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue({ createdAt: new Date('2026-10-01T00:00:00Z') });
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            await GET(makeRequest('http://localhost/api/analytics?subjectId=sub-1'));

            // 验证 count 调用包含 subjectId 条件
            expect(mocks.mockPrismaErrorItem.count).toHaveBeenCalledWith({
                where: {
                    AND: [
                        { userId: 'user-123', subjectId: 'sub-1', createdAt: { gte: expect.any(Date) } },
                        expect.any(Object),
                    ],
                },
            });
        });

        it('北京时间跨日后使用当天零点到次日零点的统计范围', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-10-18T16:01:00Z'));
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);
            try {
                const response = await GET(makeRequest('http://localhost/api/analytics?range=7d'));
                expect(response.status).toBe(200);
                expect((await response.json()).activityData.at(-1).date).toBe('10-19');
                // 验证 7 天范围的查询条件
                expect(mocks.mockPrismaErrorItem.findMany).toHaveBeenCalledWith({
                    where: {
                        userId: 'user-123',
                        createdAt: { gte: new Date('2026-10-12T16:00:00Z') },
                    },
                    select: { createdAt: true },
                });
            } finally {
                vi.useRealTimers();
            }
        });

        it('应该返回完整的统计数据', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count
                .mockResolvedValueOnce(100)  // totalErrors
                .mockResolvedValueOnce(10)   // newCount
                .mockResolvedValueOnce(15)   // reviewingCount
                .mockResolvedValueOnce(75);  // masteredCount
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([
                { subjectId: 'sub-1', _count: { id: 3 } },
            ]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([
                { id: 'sub-1', name: '数学' },
            ]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.totalErrors).toBe(100);
            expect(data.newCount).toBe(10);
            expect(data.reviewingCount).toBe(15);
            expect(data.masteredCount).toBe(75);
            expect(data.masteryRate).toBe('75.0');
            expect(data.subjectStats).toBeDefined();
            expect(data.activityData).toBeDefined();
        });

        it('应该返回正确的学科分布', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([
                { subjectId: 'sub-1', _count: { id: 3 } },
                { subjectId: 'sub-2', _count: { id: 1 } },
                { subjectId: 'sub-3', _count: { id: 1 } },
            ]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([
                { id: 'sub-1', name: '数学' },
                { id: 'sub-2', name: '物理' },
                { id: 'sub-3', name: '化学' },
            ]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);

            const mathStat = data.subjectStats.find((s: { name: string }) => s.name === '数学');
            expect(mathStat).toBeDefined();
            expect(mathStat.value).toBe(3);

            const physicsStat = data.subjectStats.find((s: { name: string }) => s.name === '物理');
            expect(physicsStat).toBeDefined();
            expect(physicsStat.value).toBe(1);
        });

        it('统计学科分布时使用 groupBy 而不是读取整行', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            await GET(makeRequest('http://localhost/api/analytics'));

            expect(mocks.mockPrismaErrorItem.groupBy).toHaveBeenCalledWith({
                by: ['subjectId'],
                where: { userId: 'user-123', createdAt: { gte: expect.any(Date) } },
                _count: { id: true },
            });
        });

        it('应该处理没有学科的错题', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([
                { subjectId: null, _count: { id: 2 } },
                { subjectId: 'sub-1', _count: { id: 1 } },
            ]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([
                { id: 'sub-1', name: '数学' },
            ]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);

            const unknownStat = data.subjectStats.find((s: { name: string }) => s.name === 'Unknown');
            expect(unknownStat).toBeDefined();
            expect(unknownStat.value).toBe(2);
        });

        it('应该返回7天的活动数据', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(5);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany
                .mockResolvedValueOnce([])   // rangeItems（createdAt）
                .mockResolvedValueOnce([]);  // masteredItems（masteryEvaluatedAt）
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics?range=7d'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.activityData).toHaveLength(7);
            expect(data.activityData[0]).toHaveProperty('date');
            expect(data.activityData[0]).toHaveProperty('count');
            expect(data.activityData[0]).toHaveProperty('added');
            expect(data.activityData[0]).toHaveProperty('mastered');
        });

        it('活动数据应按应用时区分组到正确的日期', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-10-18T20:00:00Z'));
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);
            // 北京时间 2026-10-19 凌晨 1 点（UTC 2026-10-18T17:00:00Z）
            mocks.mockPrismaErrorItem.findMany
                .mockResolvedValueOnce([
                    { createdAt: new Date('2026-10-18T17:00:00Z') },
                ])
                .mockResolvedValueOnce([]); // masteredItems
            try {
                const response = await GET(makeRequest('http://localhost/api/analytics?range=7d'));
                const data = await response.json();
                expect(response.status).toBe(200);
                // 10-19 应该有 1 条，10-18 应该为 0
                const day19 = data.activityData.find((d: { date: string }) => d.date === '10-19');
                const day18 = data.activityData.find((d: { date: string }) => d.date === '10-18');
                expect(day19).toBeDefined();
                expect(day19.count).toBe(1);
                expect(day19.added).toBe(1);
                expect(day19.mastered).toBe(0);
                expect(day18).toBeDefined();
                expect(day18.count).toBe(0);
                expect(day18.added).toBe(0);
                expect(day18.mastered).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        });

        it('应该处理零错题情况', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.totalErrors).toBe(0);
            expect(data.newCount).toBe(0);
            expect(data.reviewingCount).toBe(0);
            expect(data.masteredCount).toBe(0);
            expect(data.masteryRate).toBe(0);
        });

        it('应该使用 masteryStatusWhere 查询三种复习状态', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            await GET(makeRequest('http://localhost/api/analytics'));

            // 验证 4 次 count 调用分别对应 totalErrors、new、reviewing、mastered
            expect(mocks.mockPrismaErrorItem.count).toHaveBeenCalledTimes(4);
            // newCount 查询条件：practiceRecords none
            expect(mocks.mockPrismaErrorItem.count).toHaveBeenCalledWith({
                where: { AND: [{ userId: 'user-123', createdAt: { gte: expect.any(Date) } }, { practiceRecords: { none: { result: { not: null } } } }] },
            });
            // reviewingCount 查询条件：有记录但掌握概率低于阈值或为 null
            expect(mocks.mockPrismaErrorItem.count).toHaveBeenCalledWith({
                where: {
                    AND: [{ userId: 'user-123', createdAt: { gte: expect.any(Date) } }, {
                        practiceRecords: { some: { result: { not: null } } },
                        OR: [{ masteryProbability: null }, { masteryProbability: { lt: 0.5 } }],
                    }],
                },
            });
            // masteredCount 查询条件：有记录且掌握概率达到阈值
            expect(mocks.mockPrismaErrorItem.count).toHaveBeenCalledWith({
                where: {
                    AND: [{ userId: 'user-123', createdAt: { gte: expect.any(Date) } }, {
                        practiceRecords: { some: { result: { not: null } } },
                        masteryProbability: { gte: 0.5 },
                    }],
                },
            });
        });

        it('应该正确计算掌握率', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count
                .mockResolvedValueOnce(200)  // totalErrors
                .mockResolvedValueOnce(20)   // newCount
                .mockResolvedValueOnce(30)   // reviewingCount
                .mockResolvedValueOnce(50);  // masteredCount
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.masteryRate).toBe('25.0');
        });

        it('应该拒绝未登录用户', async () => {
            vi.mocked(getServerSession).mockResolvedValue(null);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Authentication required');
        });

        it('应该拒绝 session 中没有 user 的请求', async () => {
            vi.mocked(getServerSession).mockResolvedValue({
                user: undefined,
                expires: '2025-12-31',
            } as unknown as Session);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(data.message).toBe('Authentication required');
        });

        it('应该处理数据库错误', async () => {
            // 非 all 范围下不会查询最早记录，让 count 失败触发 500
            mocks.mockPrismaErrorItem.count.mockRejectedValue(
                new Error('Database connection failed')
            );

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.message).toBe('Failed to fetch analytics');
        });

        it('应该处理100%掌握率', async () => {
            vi.clearAllMocks();
            vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);

            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count
                .mockResolvedValueOnce(50)  // totalErrors
                .mockResolvedValueOnce(0)   // newCount
                .mockResolvedValueOnce(0)   // reviewingCount
                .mockResolvedValueOnce(50);  // masteredCount (all mastered)
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.masteryRate).toBe('100.0');
        });

        it('应该处理0%掌握率', async () => {
            vi.clearAllMocks();
            vi.mocked(getServerSession).mockResolvedValue(mocks.mockSession);

            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count
                .mockResolvedValueOnce(50)  // totalErrors
                .mockResolvedValueOnce(20)  // newCount
                .mockResolvedValueOnce(30)  // reviewingCount
                .mockResolvedValueOnce(0);  // masteredCount (none mastered)
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.masteryRate).toBe('0.0');
        });

        it('新掌握错题按 masteryEvaluatedAt 分桶且不套用 createdAt 范围', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-10-18T20:00:00Z'));
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany
                .mockResolvedValueOnce([
                    // 范围内创建的错题
                    { createdAt: new Date('2026-10-17T10:00:00Z') },
                    { createdAt: new Date('2026-10-18T10:00:00Z') },
                ])
                .mockResolvedValueOnce([
                    // 一道创建于范围之前但在范围内被掌握的错题
                    { masteryEvaluatedAt: new Date('2026-10-17T08:00:00Z') },
                    // 一道在范围之前被掌握的错题（不应计入任何桶）
                    { masteryEvaluatedAt: new Date('2026-10-10T08:00:00Z') },
                ]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);
            try {
                const response = await GET(makeRequest('http://localhost/api/analytics?range=7d'));
                const data = await response.json();
                expect(response.status).toBe(200);

                const day17 = data.activityData.find((d: { date: string }) => d.date === '10-17');
                const day18 = data.activityData.find((d: { date: string }) => d.date === '10-18');
                expect(day17).toBeDefined();
                expect(day17.added).toBe(1);
                expect(day17.mastered).toBe(1);
                expect(day18).toBeDefined();
                expect(day18.added).toBe(1);
                expect(day18.mastered).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        });

        it('新掌握错题查询应使用 masteryStatusWhere 且带学科筛选', async () => {
            mocks.mockPrismaSubject.findFirst.mockResolvedValue({ id: 'sub-1', name: '数学' });
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            await GET(makeRequest('http://localhost/api/analytics?subjectId=sub-1'));

            // 第二次 findMany 是新掌握查询，应包含学科筛选与 mastered 条件
            expect(mocks.mockPrismaErrorItem.findMany).toHaveBeenCalledTimes(2);
            expect(mocks.mockPrismaErrorItem.findMany).toHaveBeenNthCalledWith(2, {
                where: {
                    userId: 'user-123',
                    subjectId: 'sub-1',
                    masteryEvaluatedAt: { gte: expect.any(Date) },
                    AND: [{
                        practiceRecords: { some: { result: { not: null } } },
                        masteryProbability: { gte: 0.5 },
                    }],
                },
                select: { masteryEvaluatedAt: true },
            });
        });

        it('all 范围的分桶起点取最早创建与最早掌握评估时间中较早者', async () => {
            // 最早创建时间为 2026-08，最早掌握评估时间为 2026-06，应取 2026-06 作为起点
            mocks.mockPrismaErrorItem.findFirst
                .mockResolvedValueOnce({ createdAt: new Date('2026-08-15T00:00:00Z') })
                .mockResolvedValueOnce({ masteryEvaluatedAt: new Date('2026-06-10T00:00:00Z') });
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics?range=all'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.range).toBe('all');
            expect(data.granularity).toBe('month');
            // 分桶起点应为 2026-06
            expect(data.activityData[0].date).toBe('2026-06');
        });

        it('all 范围无掌握评估记录时使用最早创建时间作为分桶起点', async () => {
            mocks.mockPrismaErrorItem.findFirst
                .mockResolvedValueOnce({ createdAt: new Date('2026-08-15T00:00:00Z') })
                .mockResolvedValueOnce(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics?range=all'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.activityData[0].date).toBe('2026-08');
        });

        it('all 范围仅有掌握评估记录时使用最早掌握评估时间作为分桶起点', async () => {
            mocks.mockPrismaErrorItem.findFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ masteryEvaluatedAt: new Date('2026-05-01T00:00:00Z') });
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics?range=all'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.activityData[0].date).toBe('2026-05');
        });
    });

    describe('难度分布（difficultyStarsStats）', () => {
        function mockDifficultyStarsGroups(totalGroups: unknown, masteredGroups: unknown) {
            mocks.mockPrismaErrorItem.groupBy.mockImplementation(
                (args: { by: string[]; where?: { AND?: unknown[] } }) => {
                    if (args.by[0] !== 'difficultyStars') return Promise.resolve([]);
                    // mastered 分组查询的 where 中带 AND（含 masteryStatusWhere 条件）
                    const isMasteredQuery = Array.isArray(args.where?.AND);
                    return Promise.resolve(isMasteredQuery ? masteredGroups : totalGroups);
                }
            );
        }

        it('始终返回 1~5 星五项，未评定数量大于 0 时附加 null 项', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mockDifficultyStarsGroups([
                { difficultyStars: 1, _count: { id: 2 } },
                { difficultyStars: 3, _count: { id: 5 } },
                { difficultyStars: null, _count: { id: 4 } },
            ], []);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.difficultyStarsStats).toBeDefined();
            expect(data.difficultyStarsStats).toHaveLength(6);

            const byStars = Object.fromEntries(
                data.difficultyStarsStats.map((s: { stars: number | null; total: number; mastered: number }) => [s.stars, s])
            );
            expect(byStars[1].total).toBe(2);
            expect(byStars[2].total).toBe(0);
            expect(byStars[3].total).toBe(5);
            expect(byStars[4].total).toBe(0);
            expect(byStars[5].total).toBe(0);
            expect(byStars.null.total).toBe(4);
        });

        it('未评定数量为 0 时不返回 null 项', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mockDifficultyStarsGroups([
                { difficultyStars: 2, _count: { id: 3 } },
            ], []);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.difficultyStarsStats).toHaveLength(5);
            expect(data.difficultyStarsStats.every((s: { stars: number | null }) => s.stars !== null)).toBe(true);
        });

        it('全部为空时仍返回 1~5 星五项（total 均为 0）', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.difficultyStarsStats).toHaveLength(5);
            expect(data.difficultyStarsStats.every((s: { total: number }) => s.total === 0)).toBe(true);
        });

        it('mastered 使用 masteryStatusWhere 同口径查询并正确合并', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mockDifficultyStarsGroups([
                { difficultyStars: 1, _count: { id: 5 } },
                { difficultyStars: 3, _count: { id: 4 } },
                { difficultyStars: null, _count: { id: 2 } },
            ], [
                { difficultyStars: 1, _count: { id: 3 } },
                { difficultyStars: 3, _count: { id: 1 } },
            ]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);
            // 验证 mastered 查询使用了 masteryStatusWhere('mastered', 50)
            expect(mocks.mockPrismaErrorItem.groupBy).toHaveBeenCalledWith({
                by: ['difficultyStars'],
                where: {
                    AND: [
                        { userId: 'user-123', createdAt: { gte: expect.any(Date) } },
                        { practiceRecords: { some: { result: { not: null } } }, masteryProbability: { gte: 0.5 } },
                    ],
                },
                _count: { id: true },
            });

            const byStars = Object.fromEntries(
                data.difficultyStarsStats.map((s: { stars: number | null; total: number; mastered: number }) => [s.stars, s])
            );
            expect(byStars[1]).toEqual({ stars: 1, total: 5, mastered: 3 });
            expect(byStars[3]).toEqual({ stars: 3, total: 4, mastered: 1 });
            expect(byStars.null).toEqual({ stars: null, total: 2, mastered: 0 });
        });

        it('difficultyStarsStats 总数查询使用 scopedWhere 且不读取大字段', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            await GET(makeRequest('http://localhost/api/analytics'));

            expect(mocks.mockPrismaErrorItem.groupBy).toHaveBeenCalledWith({
                by: ['difficultyStars'],
                where: { userId: 'user-123', createdAt: { gte: expect.any(Date) } },
                _count: { id: true },
            });
        });
    });

    describe('错因分布（mistakeStatusStats / errorTypeStats）', () => {
        function mockGroupByByField(field: 'subjectId' | 'mistakeStatus' | 'errorType', value: unknown) {
            mocks.mockPrismaErrorItem.groupBy.mockImplementation(
                (args: { by: string[] }) => (args.by[0] === field ? Promise.resolve(value) : Promise.resolve([]))
            );
        }

        it('mistakeStatusStats 按 mistakeStatus 分组，null 归入 unknown', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mockGroupByByField('mistakeStatus', [
                { mistakeStatus: 'not_attempted', _count: { id: 3 } },
                { mistakeStatus: 'wrong_attempt', _count: { id: 5 } },
                { mistakeStatus: null, _count: { id: 2 } },
                { mistakeStatus: 'unknown', _count: { id: 1 } },
            ]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.mistakeStatusStats).toBeDefined();
            const byName = Object.fromEntries(
                data.mistakeStatusStats.map((s: { name: string; value: number }) => [s.name, s.value])
            );
            expect(byName.not_attempted).toBe(3);
            expect(byName.wrong_attempt).toBe(5);
            expect(byName.unknown).toBe(3);
        });

        it('mistakeStatusStats 查询使用 scopedWhere 且不读取大字段', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            await GET(makeRequest('http://localhost/api/analytics'));

            expect(mocks.mockPrismaErrorItem.groupBy).toHaveBeenCalledWith({
                by: ['mistakeStatus'],
                where: { userId: 'user-123', createdAt: { gte: expect.any(Date) } },
                _count: { id: true },
            });
        });

        it('errorTypeStats 合并首尾空格并忽略空值，超过 7 个时其余并入 __other__', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mockGroupByByField('errorType', [
                { errorType: ' 计算 ', _count: { id: 5 } },
                { errorType: '计算', _count: { id: 3 } },
                { errorType: '', _count: { id: 2 } },
                { errorType: '   ', _count: { id: 1 } },
                { errorType: null, _count: { id: 4 } },
                { errorType: '概念', _count: { id: 4 } },
                { errorType: '审题', _count: { id: 3 } },
                { errorType: '公式', _count: { id: 3 } },
                { errorType: '步骤', _count: { id: 2 } },
                { errorType: '单位', _count: { id: 2 } },
                { errorType: '符号', _count: { id: 1 } },
                { errorType: '笔误', _count: { id: 1 } },
            ]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);
            const stats = data.errorTypeStats as { name: string; value: number }[];
            const byName = Object.fromEntries(stats.map(s => [s.name, s.value]));
            // 首尾空格合并
            expect(byName['计算']).toBe(8);
            // 空值与 null 不计入
            expect(byName['']).toBeUndefined();
            // 仅保留前 7 个，其余合并为 __other__：第 7 名为 符号(1)，第 8 名为 笔误(1)
            expect(stats).toHaveLength(8);
            expect(stats[0]).toEqual({ name: '计算', value: 8 });
            expect(byName['概念']).toBe(4);
            expect(byName['审题']).toBe(3);
            expect(byName['公式']).toBe(3);
            expect(byName['步骤']).toBe(2);
            expect(byName['单位']).toBe(2);
            expect(byName['符号']).toBe(1);
            expect(byName['__other__']).toBe(1);
        });

        it('errorTypeStats 不足 7 个时不生成 __other__', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mockGroupByByField('errorType', [
                { errorType: '计算', _count: { id: 5 } },
                { errorType: '概念', _count: { id: 3 } },
            ]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            const response = await GET(makeRequest('http://localhost/api/analytics'));
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.errorTypeStats).toHaveLength(2);
            expect(data.errorTypeStats[0]).toEqual({ name: '计算', value: 5 });
        });

        it('errorTypeStats 查询使用 scopedWhere 且不读取大字段', async () => {
            mocks.mockPrismaErrorItem.findFirst.mockResolvedValue(null);
            mocks.mockPrismaErrorItem.count.mockResolvedValue(0);
            mocks.mockPrismaErrorItem.groupBy.mockResolvedValue([]);
            mocks.mockPrismaErrorItem.findMany.mockResolvedValue([]);
            mocks.mockPrismaSubject.findMany.mockResolvedValue([]);

            await GET(makeRequest('http://localhost/api/analytics'));

            expect(mocks.mockPrismaErrorItem.groupBy).toHaveBeenCalledWith({
                by: ['errorType'],
                where: { userId: 'user-123', createdAt: { gte: expect.any(Date) } },
                _count: { id: true },
            });
        });
    });
});
