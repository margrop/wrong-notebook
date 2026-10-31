/**
 * POST /api/exams/:id/retry：重新生成试卷中失败或未完成的题目
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    consumeAiQuota: vi.fn(),
    generateExamPaper: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { examPaper: { findUnique: mocks.findUnique, update: mocks.update } } }));
vi.mock('@/lib/current-user', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/ai-quota', () => ({ consumeAiQuota: mocks.consumeAiQuota }));
vi.mock('@/lib/exam', () => ({ generateExamPaper: mocks.generateExamPaper }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { POST } from '@/app/api/exams/[id]/retry/route';

const retry = (body?: unknown) => POST(
    new Request('http://localhost/api/exams/paper-1/retry', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'paper-1' }) },
);

describe('POST /api/exams/:id/retry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: 'user-1', role: 'user' });
        mocks.findUnique.mockResolvedValue({ userId: 'user-1' });
        mocks.consumeAiQuota.mockResolvedValue(null);
    });

    it('未登录时返回 401', async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        expect((await retry()).status).toBe(401);
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('试卷不存在或属于其他用户时返回 404', async () => {
        mocks.findUnique.mockResolvedValue({ userId: 'someone-else' });
        expect((await retry()).status).toBe(404);
        mocks.findUnique.mockResolvedValue(null);
        expect((await retry()).status).toBe(404);
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.generateExamPaper).not.toHaveBeenCalled();
    });

    it('标记为生成中并按指定语言在后台重新生成', async () => {
        const response = await retry({ language: 'en' });

        expect(response.status).toBe(200);
        expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'paper-1' }, data: { status: 'generating' } });
        expect(mocks.generateExamPaper).toHaveBeenCalledWith('paper-1', 'en');
    });

    it('没有请求体或语言无效时默认中文', async () => {
        await retry();
        await retry({ language: 'fr' });
        expect(mocks.generateExamPaper.mock.calls).toEqual([['paper-1', 'zh'], ['paper-1', 'zh']]);
    });

    it('AI 额度用完时返回 429，试卷状态保持不变', async () => {
        mocks.consumeAiQuota.mockResolvedValue(NextResponse.json({ code: 'AI_DAILY_LIMIT_EXCEEDED' }, { status: 429 }));

        expect((await retry()).status).toBe(429);
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.generateExamPaper).not.toHaveBeenCalled();
    });
});
