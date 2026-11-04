/**
 * 举一反三记录、掌握概率历史与短 ID 定位 API 集成测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    errorItem: { findUnique: vi.fn() },
    practiceRecord: { create: vi.fn() },
    scheduleMasteryEvaluation: vi.fn(),
    session: { user: { id: 'user-1', email: 'user@example.com' }, expires: '2099-01-01' },
}));

vi.mock('@/lib/prisma', () => ({
    prisma: { user: mocks.user, errorItem: mocks.errorItem, practiceRecord: mocks.practiceRecord },
}));
vi.mock('@/lib/ai', () => ({ getAIService: vi.fn() }));
vi.mock('@/lib/mastery', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/mastery')>()),
    scheduleMasteryEvaluation: mocks.scheduleMasteryEvaluation,
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { POST as RECORD_POST } from '@/app/api/practice/record/route';
import { GET as HISTORY_GET } from '@/app/api/error-items/[id]/practice-records/route';
import { GET as SHORT_GET } from '@/app/api/error-items/short/[shortId]/route';

const postRecord = (body: object) => RECORD_POST(new Request('http://localhost/api/practice/record', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
}));

describe('POST /api/practice/record（关联原题）', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
        mocks.practiceRecord.create.mockImplementation(async (args: { data: object }) => ({ id: 'r1', ...args.data }));
    });

    it('保存结果、题目内容并触发掌握概率评估', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1' });

        const response = await postRecord({
            errorItemId: 'item-1',
            result: 'not_attempted',
            difficulty: 'hard',
            questionText: '新题',
            answerText: '答案',
            analysis: '解析',
        });

        expect(response.status).toBe(200);
        expect(mocks.practiceRecord.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                userId: 'user-1',
                errorItemId: 'item-1',
                result: 'not_attempted',
                isCorrect: false,
                source: 'practice',
                questionText: '新题',
            }),
        });
        expect(mocks.scheduleMasteryEvaluation).toHaveBeenCalledWith(['item-1']);
    });

    it('不能为他人的错题写入记录', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'someone-else' });

        const response = await postRecord({ errorItemId: 'item-1', result: 'correct' });

        expect(response.status).toBe(404);
        expect(mocks.practiceRecord.create).not.toHaveBeenCalled();
    });

    it('拒绝非法结果值', async () => {
        const response = await postRecord({ errorItemId: 'item-1', result: 'maybe' });
        expect(response.status).toBe(400);
    });

    it('旧客户端只传 isCorrect 时换算结果', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1' });

        await postRecord({ errorItemId: 'item-1', isCorrect: true, difficulty: 'easy' });

        expect(mocks.practiceRecord.create.mock.calls[0][0].data).toMatchObject({ result: 'correct', isCorrect: true });
    });
});

describe('GET /api/error-items/:id/practice-records', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
    });

    it('返回掌握概率与记录，并展开试卷来源', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({
            userId: 'user-1',
            masteryLevel: 1,
            masteryProbability: 0.85,
            masteryReason: '连续做对',
            masterySource: 'ai',
            masteryEvaluatedAt: new Date('2026-10-02'),
            practiceRecords: [
                { id: 'r2', result: 'correct', source: 'exam', createdAt: new Date('2026-10-02'), examQuestion: { paperId: 'p1', order: 3, paper: { title: '数学测试' } } },
                { id: 'r1', result: 'wrong', source: 'practice', createdAt: new Date('2026-10-01'), examQuestion: null },
            ],
        });

        const response = await HISTORY_GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'item-1' }) });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.masteryProbability).toBe(0.85);
        expect(data).not.toHaveProperty('userId');
        expect(data.records[0].exam).toEqual({ paperId: 'p1', order: 3, title: '数学测试' });
        expect(data.records[1].exam).toBeNull();
    });

    it('他人的错题返回 403', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'other', practiceRecords: [] });

        const response = await HISTORY_GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'item-1' }) });

        expect(response.status).toBe(403);
    });
});

describe('GET /api/error-items/short/:shortId', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
    });

    it('按短 ID 定位自己的题目', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ id: 'item-1', userId: 'user-1', subjectId: 's1', shortId: 'aB3xYz' });

        const response = await SHORT_GET(new Request('http://localhost'), { params: Promise.resolve({ shortId: 'aB3xYz' }) });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ id: 'item-1', subjectId: 's1', shortId: 'aB3xYz' });
    });

    it('他人的题目与非法格式都返回 404', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ id: 'item-1', userId: 'other', subjectId: null, shortId: 'aB3xYz' });
        const foreign = await SHORT_GET(new Request('http://localhost'), { params: Promise.resolve({ shortId: 'aB3xYz' }) });
        const invalid = await SHORT_GET(new Request('http://localhost'), { params: Promise.resolve({ shortId: 'O0Il00' }) });

        expect(foreign.status).toBe(404);
        expect(invalid.status).toBe(404);
    });
});
