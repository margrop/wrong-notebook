/**
 * POST /api/exams/:id/retry：重新生成试卷中失败或未完成的题目
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { resetBackgroundTasksForTest } from '@/lib/background-tasks';

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    consumeAiQuota: vi.fn(),
    generateExamPaper: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        examPaper: { findUnique: mocks.findUnique, update: mocks.update },
        user: { findUnique: vi.fn(async () => ({ id: 'user-1', email: 'user@example.com' })) },
    },
}));
vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/ai-quota', () => ({ consumeAiQuota: mocks.consumeAiQuota }));
vi.mock('@/lib/exam/exam', () => ({ generateExamPaper: mocks.generateExamPaper }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { POST } from '@/app/api/exams/[id]/retry/route';

const retry = (body?: unknown) => POST(
    new Request('http://localhost/api/exams/paper-1/retry', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'paper-1' }) },
);

describe('POST /api/exams/:id/retry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetBackgroundTasksForTest();
        mocks.getServerSession.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com' }, expires: '2099-01-01' });
        mocks.findUnique.mockResolvedValue({ userId: 'user-1' });
        mocks.consumeAiQuota.mockResolvedValue(null);
        // 默认：立即 succeed，避免 handle 残留 running 状态
        mocks.generateExamPaper.mockImplementation((_id: string, _lang: string, handle: { succeed: () => void }) => {
            handle.succeed();
        });
    });

    it('未登录时返回 401', async () => {
        mocks.getServerSession.mockResolvedValue(null);
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
        expect(mocks.generateExamPaper).toHaveBeenCalledWith('paper-1', 'en', expect.objectContaining({ target: 'exam-paper:paper-1:generate' }));
    });

    it('没有请求体或语言无效时默认中文', async () => {
        await retry();
        await retry({ language: 'fr' });
        expect(mocks.generateExamPaper.mock.calls.map((call) => [call[0], call[1]])).toEqual([['paper-1', 'zh'], ['paper-1', 'zh']]);
    });

    it('AI 额度用完时返回 429，试卷状态保持不变', async () => {
        mocks.consumeAiQuota.mockResolvedValue(NextResponse.json({ code: 'AI_DAILY_LIMIT_EXCEEDED' }, { status: 429 }));

        expect((await retry()).status).toBe(429);
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.generateExamPaper).not.toHaveBeenCalled();
    });

    it('并发重试时第二次返回 409，不重复扣额度、不重复生成', async () => {
        // 让 generateExamPaper 不立即结束（保留 handle 的 running 状态）
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        mocks.generateExamPaper.mockImplementation((_id: string, _lang: string, handle: { succeed: () => void }) => {
            gate.then(() => handle.succeed());
        });

        const first = retry({ language: 'zh' });
        const second = await retry({ language: 'zh' });

        expect(second.status).toBe(409);
        const body = await second.json() as { code?: string };
        expect(body.code).toBe('TASK_ALREADY_RUNNING');

        await first;
        release();

        expect(mocks.consumeAiQuota).toHaveBeenCalledTimes(1);
        expect(mocks.generateExamPaper).toHaveBeenCalledTimes(1);
        expect(mocks.update).toHaveBeenCalledTimes(1);
    });

    it('额度不足后任务可再次发起（cancel 不留记录）', async () => {
        mocks.consumeAiQuota.mockResolvedValueOnce(NextResponse.json({ code: 'AI_DAILY_LIMIT_EXCEEDED' }, { status: 429 }));

        expect((await retry()).status).toBe(429);

        // 第二次额度充足，能成功发起
        mocks.consumeAiQuota.mockResolvedValueOnce(null);
        expect((await retry({ language: 'zh' })).status).toBe(200);
    });
});
