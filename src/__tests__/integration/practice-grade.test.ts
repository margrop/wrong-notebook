/**
 * 举一反三判题 API 集成测试
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    errorItem: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    gradeAnswer: vi.fn(),
    consumeAiQuota: vi.fn(),
    session: { user: { id: 'user-1', email: 'user@example.com' }, expires: '2099-01-01' },
    dbUser: { id: 'user-1', email: 'user@example.com', name: 'Test User' },
}));

vi.mock('@/lib/prisma', () => ({ prisma: { errorItem: mocks.errorItem, user: mocks.user } }));
vi.mock('@/lib/ai', () => ({ getAIService: () => ({ gradeAnswer: mocks.gradeAnswer }) }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/ai-quota', () => ({ consumeAiQuota: mocks.consumeAiQuota }));

import { POST } from '@/app/api/practice/grade/route';

const lastPractice = JSON.stringify({
    questionText: '解方程 x² = 4', answerText: 'x = 2 或 x = -2', analysis: '开平方', difficulty: 'medium', generatedAt: '2026-10-20T00:00:00.000Z',
});

const grade = (body: object) => POST(new Request('http://localhost/api/practice/grade', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
}));

describe('POST /api/practice/grade', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.user.findUnique.mockResolvedValue(mocks.dbUser);
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1', lastPractice });
        mocks.gradeAnswer.mockResolvedValue({ correct: false, reason: '只答出一个解' });
        mocks.consumeAiQuota.mockResolvedValue(null);
    });

    it('用服务端暂存的题目和标准答案判题', async () => {
        const response = await grade({ errorItemId: 'item-1', userAnswer: ' x=2 ', language: 'zh', answerText: '客户端伪造的答案' });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ correct: false, reason: '只答出一个解' });
        expect(mocks.gradeAnswer).toHaveBeenCalledWith({
            questionText: '解方程 x² = 4', answerText: 'x = 2 或 x = -2', analysis: '开平方', userAnswer: 'x=2', language: 'zh',
        });
    });

    it('不能对他人的错题判题', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'someone-else', lastPractice });
        expect((await grade({ errorItemId: 'item-1', userAnswer: '2' })).status).toBe(404);
        expect(mocks.gradeAnswer).not.toHaveBeenCalled();
    });

    it('没有暂存题目时返回 404', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1', lastPractice: null });
        expect((await grade({ errorItemId: 'item-1', userAnswer: '2' })).status).toBe(404);
    });

    it('答案为空时校验失败', async () => {
        expect((await grade({ errorItemId: 'item-1', userAnswer: '   ' })).status).toBe(400);
    });

    it('每日 AI 次数用完时返回 429，不调用 AI', async () => {
        mocks.consumeAiQuota.mockResolvedValue(new Response(JSON.stringify({ message: 'AI_DAILY_LIMIT_EXCEEDED' }), { status: 429 }));

        expect((await grade({ errorItemId: 'item-1', userAnswer: '2' })).status).toBe(429);
        expect(mocks.consumeAiQuota).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'grade');
        expect(mocks.gradeAnswer).not.toHaveBeenCalled();
    });

    it('AI 失败时返回 500，由页面改为用户自行判定', async () => {
        mocks.gradeAnswer.mockRejectedValue(new Error('AI_TIMEOUT_ERROR'));
        expect((await grade({ errorItemId: 'item-1', userAnswer: '2' })).status).toBe(500);
    });
});
