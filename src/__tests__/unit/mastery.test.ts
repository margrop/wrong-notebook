/**
 * 掌握概率计算单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    findUsers: vi.fn(),
    evaluateMastery: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        errorItem: { findUnique: mocks.findUnique, update: mocks.update, count: mocks.count },
        user: { findMany: mocks.findUsers },
    },
}));
vi.mock('@/lib/ai', () => ({
    getAIService: vi.fn(() => ({ evaluateMastery: mocks.evaluateMastery })),
}));
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

import { getAIService } from '@/lib/ai';
import { DEFAULT_MASTERY_THRESHOLD, computeRuleMastery, countByMasteryStatus, evaluateErrorItemMastery, isPracticeResult, masteryLevelFor } from '@/lib/mastery';

const record = (result: string, difficulty = 'medium', day = 1) => ({
    result,
    difficulty,
    source: 'practice',
    createdAt: new Date(`2026-10-${String(day).padStart(2, '0')}T00:00:00Z`),
});

describe('computeRuleMastery', () => {
    it('没有记录时返回 null', () => {
        expect(computeRuleMastery([])).toBeNull();
    });

    it('连续做对中等难度达到掌握阈值', () => {
        const history = [1, 2, 3].map(() => ({ result: 'correct' as const, difficulty: 'medium' }));
        expect(computeRuleMastery(history)!).toBeGreaterThanOrEqual(DEFAULT_MASTERY_THRESHOLD / 100);
    });

    it('只做对一次时低于连续做对', () => {
        const once = computeRuleMastery([{ result: 'correct', difficulty: 'medium' }])!;
        const thrice = computeRuleMastery([1, 2, 3].map(() => ({ result: 'correct' as const, difficulty: 'medium' })))!;
        expect(once).toBeLessThan(thrice);
    });

    it('只做错一次时低于掌握阈值', () => {
        expect(computeRuleMastery([{ result: 'wrong', difficulty: 'medium' }])!).toBeLessThan(DEFAULT_MASTERY_THRESHOLD / 100);
    });

    it('近期结果权重更高', () => {
        const recentWrong = computeRuleMastery([
            { result: 'correct', difficulty: 'medium' },
            { result: 'wrong', difficulty: 'medium' },
        ])!;
        const recentCorrect = computeRuleMastery([
            { result: 'wrong', difficulty: 'medium' },
            { result: 'correct', difficulty: 'medium' },
        ])!;
        expect(recentCorrect).toBeGreaterThan(recentWrong);
    });

    it('不会做比做错得分更低', () => {
        const wrong = computeRuleMastery([{ result: 'wrong', difficulty: 'medium' }])!;
        const notAttempted = computeRuleMastery([{ result: 'not_attempted', difficulty: 'medium' }])!;
        expect(notAttempted).toBeLessThan(wrong);
    });

    it('做对更高难度的题得分更高', () => {
        const easy = computeRuleMastery([{ result: 'correct', difficulty: 'easy' }])!;
        const hard = computeRuleMastery([{ result: 'correct', difficulty: 'hard' }])!;
        expect(hard).toBeGreaterThan(easy);
    });
});

describe('辅助函数', () => {
    it('masteryLevelFor 默认按 50% 阈值区分复习中和已掌握', () => {
        expect(DEFAULT_MASTERY_THRESHOLD).toBe(50);
        expect(masteryLevelFor(0.5)).toBe(2);
        expect(masteryLevelFor(0.49)).toBe(1);
    });

    it('masteryLevelFor 按传入的用户阈值区分', () => {
        expect(masteryLevelFor(0.7, 80)).toBe(1);
        expect(masteryLevelFor(0.8, 80)).toBe(2);
        expect(masteryLevelFor(0.3, 30)).toBe(2);
    });

    it('isPracticeResult 只接受三种结果', () => {
        expect(isPracticeResult('correct')).toBe(true);
        expect(isPracticeResult('not_attempted')).toBe(true);
        expect(isPracticeResult('unknown')).toBe(false);
    });
});

describe('evaluateErrorItemMastery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('AI 评估成功时保存 AI 概率并按阈值自动标记', async () => {
        mocks.findUnique.mockResolvedValue({
            id: 'item-1',
            userId: 'user-1',
            questionText: '题目',
            mistakeStatus: 'wrong_attempt',
            user: { masteryThreshold: 50, aiDataConsentAt: new Date() },
            tags: [{ name: '方程' }],
            practiceRecords: [record('correct', 'hard', 1), record('correct', 'hard', 2)],
        });
        mocks.evaluateMastery.mockResolvedValue({ probability: 0.86, reason: '连续做对困难题' });

        await evaluateErrorItemMastery('item-1');

        // 后台评估的用量记在错题所属用户名下，单独归为 mastery
        expect(getAIService).toHaveBeenCalledWith({ userId: 'user-1', kind: 'mastery' });
        const input = mocks.evaluateMastery.mock.calls[0][0];
        expect(input.knowledgePoints).toEqual(['方程']);
        expect(input.history).toHaveLength(2);
        expect(mocks.update).toHaveBeenCalledWith({
            where: { id: 'item-1' },
            data: expect.objectContaining({ masteryProbability: 0.86, masterySource: 'ai', masteryLevel: 2, masteryReason: '连续做对困难题' }),
        });
    });

    it('按错题所属用户的阈值标记 masteryLevel', async () => {
        mocks.findUnique.mockResolvedValue({
            id: 'item-1',
            questionText: '题目',
            mistakeStatus: null,
            user: { masteryThreshold: 90, aiDataConsentAt: new Date() },
            tags: [],
            practiceRecords: [record('correct', 'hard', 1)],
        });
        mocks.evaluateMastery.mockResolvedValue({ probability: 0.86, reason: '做对一次' });

        await evaluateErrorItemMastery('item-1');

        expect(mocks.update.mock.calls[0][0].data.masteryLevel).toBe(1);
    });

    it('用户未同意 AI 数据授权时不调用 AI，按规则估算', async () => {
        mocks.findUnique.mockResolvedValue({
            id: 'item-1',
            questionText: '题目',
            mistakeStatus: null,
            user: { masteryThreshold: 50, aiDataConsentAt: null },
            tags: [],
            practiceRecords: [record('correct', 'hard', 1)],
        });

        await evaluateErrorItemMastery('item-1');

        expect(mocks.evaluateMastery).not.toHaveBeenCalled();
        expect(mocks.update.mock.calls[0][0].data.masterySource).toBe('rule');
    });

    it('AI 失败时使用规则公式兜底', async () => {
        mocks.findUnique.mockResolvedValue({
            id: 'item-1',
            questionText: '题目',
            mistakeStatus: null,
            user: { masteryThreshold: 50 },
            tags: [],
            practiceRecords: [record('wrong')],
        });
        mocks.evaluateMastery.mockRejectedValue(new Error('AI_CONNECTION_FAILED'));

        await evaluateErrorItemMastery('item-1');

        const data = mocks.update.mock.calls[0][0].data;
        expect(data.masterySource).toBe('rule');
        expect(data.masteryLevel).toBe(1);
        expect(data.masteryProbability).toBe(computeRuleMastery([{ result: 'wrong', difficulty: 'medium' }]));
    });

    it('记录全部删除后清空掌握概率，恢复为待复习', async () => {
        mocks.findUnique.mockResolvedValue({ id: 'item-1', questionText: '', mistakeStatus: null, user: { masteryThreshold: 50 }, tags: [], practiceRecords: [] });

        await evaluateErrorItemMastery('item-1');

        expect(mocks.evaluateMastery).not.toHaveBeenCalled();
        const data = mocks.update.mock.calls[0][0].data;
        expect(data.masteryProbability).toBeNull();
        expect(data.masteryLevel).toBe(0);
    });
});

describe('countByMasteryStatus', () => {
    it('按各用户的阈值分组统计后汇总', async () => {
        mocks.findUsers.mockResolvedValue([{ masteryThreshold: 50 }, { masteryThreshold: 80 }]);
        mocks.count.mockImplementation(async ({ where }: { where: { AND: [unknown, { user: { masteryThreshold: number } }, Record<string, unknown>] } }) => {
            const [, { user }, condition] = where.AND;
            if ('none' in (condition.practiceRecords as object)) return 1;
            if ('OR' in condition) return user.masteryThreshold === 80 ? 3 : 2;
            return user.masteryThreshold === 80 ? 5 : 4;
        });

        await expect(countByMasteryStatus({ userId: 'u1' })).resolves.toEqual({ new: 2, reviewing: 5, mastered: 9 });
        const conditions = mocks.count.mock.calls.map(([args]) => args.where.AND);
        expect(conditions).toContainEqual([{ userId: 'u1' }, { user: { masteryThreshold: 80 } }, expect.objectContaining({ masteryProbability: { gte: 0.8 } })]);
        expect(conditions).toContainEqual([{ userId: 'u1' }, { user: { masteryThreshold: 50 } }, expect.objectContaining({ masteryProbability: { gte: 0.5 } })]);
    });
});
