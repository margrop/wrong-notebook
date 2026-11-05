/**
 * /api/error-items/:id/figure 集成测试：用原题图片重绘 SVG 配图
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    errorItem: { findUnique: vi.fn(), update: vi.fn() },
    generateFigureSvg: vi.fn(),
    consumeAiQuota: vi.fn(),
    session: { user: { email: 'user@example.com' }, expires: '2099-01-01' } as { user: { email: string }; expires: string } | null,
}));

vi.mock('@/lib/prisma', () => ({ prisma: { user: mocks.user, errorItem: mocks.errorItem } }));
vi.mock('@/lib/ai', () => ({ getAIService: vi.fn(() => ({ generateFigureSvg: mocks.generateFigureSvg })) }));
vi.mock('@/lib/ai-quota', () => ({ consumeAiQuota: mocks.consumeAiQuota }));
vi.mock('@/lib/db-write-queue', () => ({ serializeWrite: (fn: () => Promise<unknown>) => fn() }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { POST } from '@/app/api/error-items/[id]/figure/route';
import { getAIService } from '@/lib/ai';
import { resetBackgroundTasksForTest } from '@/lib/background-tasks';

const call = () => POST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: 'e1' }) });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

describe('POST /api/error-items/:id/figure', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1', originalImageUrl: 'data:image/png;base64,QUJD', questionText: '如图，求三角形面积' });
        mocks.errorItem.update.mockImplementation(async ({ data }) => data);
        mocks.consumeAiQuota.mockResolvedValue(null);
        resetBackgroundTasksForTest();
    });

    it('把原题图片和题干交给 AI，保存识别出的配图', async () => {
        mocks.generateFigureSvg.mockResolvedValue({ hasFigure: true, figureSvg: svg });

        const response = await call();

        expect(response.status).toBe(200);
        expect(mocks.generateFigureSvg).toHaveBeenCalledWith('QUJD', 'image/png', '如图，求三角形面积');
        // 用量记在发起操作的用户名下
        expect(getAIService).toHaveBeenCalledWith({ userId: 'user-1', kind: 'figure' });
        expect(mocks.errorItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { hasFigure: true, figureSvg: svg } }));
        expect(await response.json()).toEqual({ hasFigure: true, figureSvg: svg });
    });

    it('AI 判断没有配图时清除旧配图', async () => {
        mocks.generateFigureSvg.mockResolvedValue({ hasFigure: false, figureSvg: null });

        await call();

        expect(mocks.errorItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { hasFigure: false, figureSvg: null } }));
    });

    it('未登录 401，他人题目 404，没有原图 400，均不调用 AI', async () => {
        mocks.session = null;
        expect((await call()).status).toBe(401);

        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.errorItem.findUnique.mockResolvedValueOnce({ userId: 'other', originalImageUrl: 'data:image/png;base64,QUJD', questionText: '' });
        expect((await call()).status).toBe(404);

        mocks.errorItem.findUnique.mockResolvedValueOnce({ userId: 'user-1', originalImageUrl: '', questionText: '文字题' });
        const noImage = await call();
        expect(noImage.status).toBe(400);
        expect((await noImage.json()).message).toBe('NO_ORIGINAL_IMAGE');

        expect(mocks.generateFigureSvg).not.toHaveBeenCalled();
        expect(mocks.errorItem.update).not.toHaveBeenCalled();
    });

    it('AI 错误码透传给前端', async () => {
        mocks.generateFigureSvg.mockRejectedValue(new Error('AI_TIMEOUT_ERROR'));

        const response = await call();

        expect(response.status).toBe(500);
        expect((await response.json()).message).toBe('AI_TIMEOUT_ERROR');
    });

    it('同一错题并发两次，第二个返回 409 且只扣一次额度、只调用一次 AI', async () => {
        let finish!: (value: unknown) => void;
        mocks.generateFigureSvg.mockReturnValue(new Promise((resolve) => { finish = resolve; }));

        const first = call();
        await vi.waitFor(() => expect(mocks.generateFigureSvg).toHaveBeenCalledTimes(1));

        const second = await call();
        expect(second.status).toBe(409);
        expect((await second.json()).code).toBe('TASK_ALREADY_RUNNING');
        expect(mocks.consumeAiQuota).toHaveBeenCalledTimes(1);
        expect(mocks.generateFigureSvg).toHaveBeenCalledTimes(1);

        finish({ hasFigure: true, figureSvg: svg });
        expect((await first).status).toBe(200);
    });

    it('任务结束后可再次发起', async () => {
        mocks.generateFigureSvg.mockResolvedValue({ hasFigure: true, figureSvg: svg });

        expect((await call()).status).toBe(200);
        expect((await call()).status).toBe(200);
        expect(mocks.consumeAiQuota).toHaveBeenCalledTimes(2);
        expect(mocks.generateFigureSvg).toHaveBeenCalledTimes(2);
    });

    it('额度不足时 cancel 预占，不调用 AI，之后可再次发起', async () => {
        mocks.consumeAiQuota.mockResolvedValueOnce(new Response(null, { status: 429 }));
        mocks.generateFigureSvg.mockResolvedValue({ hasFigure: true, figureSvg: svg });

        const limited = await call();
        expect(limited.status).toBe(429);
        expect(mocks.generateFigureSvg).not.toHaveBeenCalled();

        // 预占已 cancel，可再次发起
        expect((await call()).status).toBe(200);
        expect(mocks.generateFigureSvg).toHaveBeenCalledTimes(1);
    });
});
