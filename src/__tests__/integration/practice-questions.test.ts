/**
 * /api/practice/questions API 集成测试
 * 验证历史练习题的筛选、归属校验与作答记录引用。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    practiceQuestion: {
        count: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
    },
    errorItem: { findUnique: vi.fn() },
    practiceRecord: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    session: { user: { id: 'user-123', email: 'user@example.com', name: 'Test User', role: 'user' }, expires: '2025-12-31' },
    userRecord: { id: 'user-123', email: 'user@example.com', name: 'Test User', role: 'user' },
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        practiceQuestion: mocks.practiceQuestion,
        errorItem: mocks.errorItem,
        practiceRecord: mocks.practiceRecord,
        user: mocks.user,
    },
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/logger', () => ({
    createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { GET as LIST_GET } from '@/app/api/practice/questions/route';
import { GET as DETAIL_GET } from '@/app/api/practice/questions/[id]/route';
import { POST as RECORD_POST } from '@/app/api/practice/record/route';

const questionRow = {
    id: 'pq-1', userId: 'user-123', subject: '数学', difficulty: 'medium', source: 'ai',
    questionText: '求解 2x = 8', answerText: 'x = 4', analysis: '两边除以 2', figureSvg: null,
    generatedAt: new Date('2026-11-14T00:00:00Z'), createdAt: new Date('2026-11-14T00:00:00Z'),
    errorItem: { id: 'item-1', shortId: 'abc', seqNo: 7, questionText: '原题', subject: { id: 'nb-1', name: '数学' } },
    attempts: [{ id: 'a-1', result: 'wrong', isCorrect: false, createdAt: new Date('2026-11-14T01:00:00Z') }],
};

describe('/api/practice/questions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.user.findUnique.mockResolvedValue(mocks.userRecord);
    });

    it('按错题本、知识点、难度与作答状态筛选并返回最近一次作答', async () => {
        mocks.practiceQuestion.count.mockResolvedValue(1);
        mocks.practiceQuestion.findMany.mockResolvedValue([{ ...questionRow, _count: { attempts: 2 } }]);

        const response = await LIST_GET(new Request('http://localhost/api/practice/questions?notebookId=nb-1&tag=一元一次方程&difficulty=medium&status=attempted&page=1'));
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.total).toBe(1);
        expect(data.items[0]).toMatchObject({ id: 'pq-1', attemptCount: 2, lastAttempt: { result: 'wrong' } });
        expect(mocks.practiceQuestion.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                userId: 'user-123',
                difficulty: 'medium',
                attempts: { some: {} },
                errorItem: { subjectId: 'nb-1', tags: { some: { name: '一元一次方程' } } },
            }),
        }));
    });

    it('读取不属于当前账户的题目返回 404', async () => {
        mocks.practiceQuestion.findUnique.mockResolvedValue({ ...questionRow, userId: 'other-user' });

        const response = await DETAIL_GET(new Request('http://localhost/api/practice/questions/pq-1'), { params: Promise.resolve({ id: 'pq-1' }) });

        expect(response.status).toBe(404);
    });

    it('历史题作答记录引用生成题，并从题目补齐答案与学科', async () => {
        mocks.practiceQuestion.findUnique.mockResolvedValue({
            userId: 'user-123', errorItemId: 'item-1', subject: '数学', difficulty: 'medium',
            questionText: '求解 2x = 8', answerText: 'x = 4', analysis: '两边除以 2', figureSvg: null,
        });
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-123', subject: { name: '数学' } });
        mocks.practiceRecord.create.mockResolvedValue({ id: 'rec-1' });

        const response = await RECORD_POST(new Request('http://localhost/api/practice/record', {
            method: 'POST',
            body: JSON.stringify({ practiceQuestionId: 'pq-1', result: 'correct' }),
            headers: { 'Content-Type': 'application/json' },
        }));

        expect(response.status).toBe(200);
        expect(mocks.practiceRecord.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                userId: 'user-123', practiceQuestionId: 'pq-1', errorItemId: 'item-1',
                subject: '数学', difficulty: 'medium', questionText: '求解 2x = 8', answerText: 'x = 4', result: 'correct',
            }),
        });
    });

    it('原题已删除时仍保存历史题的作答结果', async () => {
        mocks.practiceQuestion.findUnique.mockResolvedValue({
            userId: 'user-123', errorItemId: null, subject: '数学', difficulty: 'medium',
            questionText: '求解 2x = 8', answerText: 'x = 4', analysis: '两边除以 2', figureSvg: null,
        });
        mocks.practiceRecord.create.mockResolvedValue({ id: 'rec-1' });

        const response = await RECORD_POST(new Request('http://localhost/api/practice/record', {
            method: 'POST',
            body: JSON.stringify({ practiceQuestionId: 'pq-1', result: 'correct' }),
            headers: { 'Content-Type': 'application/json' },
        }));

        expect(response.status).toBe(200);
        expect(mocks.practiceRecord.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ practiceQuestionId: 'pq-1', result: 'correct', isCorrect: true }),
        });
        expect(mocks.errorItem.findUnique).not.toHaveBeenCalled();
    });
});
