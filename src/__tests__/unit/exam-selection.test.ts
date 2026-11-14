/**
 * 组卷选题的新筛选：上次作答结果与按知识点均衡。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    findMany: vi.fn(),
    getMasteryThreshold: vi.fn(() => Promise.resolve(0.5)),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { errorItem: { findMany: mocks.findMany } } }));
vi.mock('@/lib/mastery', () => ({ getMasteryThreshold: mocks.getMasteryThreshold }));
vi.mock('@/lib/ai', () => ({ getAIService: vi.fn() }));

import { selectSourceItems } from '@/lib/exam/exam';

const baseSelection = { subjectIds: ['s1'], scope: 'all' as const, count: 10 };

function candidate(id: string, tag: string, last: { result: string; isCorrect: boolean } | null) {
    return {
        id, shortId: id.toUpperCase(), questionType: null, difficultyStars: 2,
        knowledgePoints: JSON.stringify([tag]), tags: [{ name: tag }],
        practiceRecords: last ? [last] : [],
        _count: { practiceRecords: 1, examQuestions: 0 },
    };
}

describe('selectSourceItems 结果与知识点筛选', () => {
    beforeEach(() => vi.clearAllMocks());

    it('只抽上次答错的题', async () => {
        mocks.findMany.mockResolvedValue([
            candidate('a', '函数', { result: 'wrong', isCorrect: false }),
            candidate('b', '函数', { result: 'correct', isCorrect: true }),
            candidate('c', '函数', null),
        ]);
        const picked = await selectSourceItems('u1', { ...baseSelection, count: 5, lastResult: 'wrong' });
        expect(picked.map((item) => item.id)).toEqual(['a']);
    });

    it('只抽上次答对的题', async () => {
        mocks.findMany.mockResolvedValue([
            candidate('a', '函数', { result: 'wrong', isCorrect: false }),
            candidate('b', '函数', { result: 'correct', isCorrect: true }),
        ]);
        const picked = await selectSourceItems('u1', { ...baseSelection, count: 5, lastResult: 'correct' });
        expect(picked.map((item) => item.id)).toEqual(['b']);
    });

    it('按知识点均衡分配题数', async () => {
        mocks.findMany.mockResolvedValue([
            candidate('a1', '函数', null), candidate('a2', '函数', null), candidate('a3', '函数', null),
            candidate('b1', '几何', null), candidate('b2', '几何', null), candidate('b3', '几何', null),
        ]);
        const picked = await selectSourceItems('u1', {
            ...baseSelection, count: 4, tagNames: ['函数', '几何'], balanceByTag: true, pickRule: 'random',
        });
        expect(picked.filter((item) => item.tags[0].name === '函数')).toHaveLength(2);
        expect(picked.filter((item) => item.tags[0].name === '几何')).toHaveLength(2);
    });

    it('知识点题量不足时由其他候选题补齐', async () => {
        mocks.findMany.mockResolvedValue([
            candidate('a1', '函数', null),
            candidate('b1', '几何', null), candidate('b2', '几何', null),
        ]);
        const picked = await selectSourceItems('u1', {
            ...baseSelection, count: 4, tagNames: ['函数', '几何'], balanceByTag: true, pickRule: 'random',
        });
        expect(picked).toHaveLength(3);
    });
});
