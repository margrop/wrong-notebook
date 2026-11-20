import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    aiUsage: { count: vi.fn(), create: vi.fn() },
    aiDailyUsage: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    transaction: vi.fn(),
    config: { aiDailyLimit: 3 } as { aiDailyLimit?: number },
}));

vi.mock('@/lib/prisma', () => ({ prisma: {
    aiUsage: mocks.aiUsage,
    aiDailyUsage: mocks.aiDailyUsage,
    $transaction: mocks.transaction,
} }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => mocks.config, getAppTimeZone: () => 'Asia/Shanghai' }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { consumeAiQuota, countTodayAiUsage } from '@/lib/ai-quota';

const student = { id: 'kid', role: 'user' };

describe('consumeAiQuota', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.config = { aiDailyLimit: 3 };
        mocks.aiUsage.count.mockResolvedValue(0);
        mocks.aiUsage.create.mockResolvedValue({});
        mocks.aiDailyUsage.findUnique.mockResolvedValue(null);
        mocks.aiDailyUsage.create.mockResolvedValue({});
        mocks.aiDailyUsage.update.mockResolvedValue({});
        mocks.transaction.mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) => operation({
            aiUsage: mocks.aiUsage,
            aiDailyUsage: mocks.aiDailyUsage,
        }));
    });

    it('未达上限时记录一次调用并放行', async () => {
        mocks.aiUsage.count.mockResolvedValue(2);

        expect(await consumeAiQuota(student, 'practice')).toBeNull();
        expect(mocks.aiUsage.create).toHaveBeenCalledWith({ data: { userId: 'kid', kind: 'practice' } });
    });

    it('达到上限时返回 429，不再记录', async () => {
        mocks.aiUsage.count.mockResolvedValue(3);

        const response = await consumeAiQuota(student, 'analyze');

        expect(response?.status).toBe(429);
        expect(await response?.json()).toEqual({ message: 'AI_DAILY_LIMIT_EXCEEDED', code: 'AI_DAILY_LIMIT_EXCEEDED', details: { limit: 3 } });
        expect(mocks.aiUsage.create).not.toHaveBeenCalled();
    });

    it('管理员和未设上限时不受限制，但记录用量', async () => {
        mocks.aiUsage.count.mockResolvedValue(99);
        expect(await consumeAiQuota({ id: 'parent', role: 'admin' }, 'exam')).toBeNull();

        mocks.config = { aiDailyLimit: 0 };
        expect(await consumeAiQuota(student, 'exam')).toBeNull();
        expect(mocks.aiUsage.count).not.toHaveBeenCalled();
        expect(mocks.aiUsage.create).toHaveBeenCalledTimes(2);
    });

    it('统计失败时放行，不影响正常使用', async () => {
        mocks.aiUsage.count.mockRejectedValue(new Error('database locked'));
        expect(await consumeAiQuota(student, 'grade')).toBeNull();
    });
});

describe('countTodayAiUsage', () => {
    it('按应用时区的今天统计', async () => {
        mocks.aiUsage.count.mockResolvedValue(5);

        // 北京时间 2026-10-20 01:00
        expect(await countTodayAiUsage('kid', new Date('2026-10-19T17:00:00Z'))).toBe(5);
        expect(mocks.aiUsage.count).toHaveBeenCalledWith({
            where: { userId: 'kid', createdAt: { gte: new Date('2026-10-19T16:00:00Z'), lt: new Date('2026-10-20T16:00:00Z') } },
        });
    });
});
