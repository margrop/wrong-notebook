// @vitest-environment node
/**
 * /api/import-tasks/:id/figure 集成测试：用任务原图重绘配图并合并回待校对的识别结果
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    importTask: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    generateFigureSvg: vi.fn(),
    consumeAiQuota: vi.fn(),
    session: { user: { email: 'user@example.com' }, expires: '2099-01-01' } as { user: { email: string }; expires: string } | null,
}));

vi.mock('@/lib/prisma', () => ({ prisma: { user: mocks.user, importTask: mocks.importTask } }));
vi.mock('@/lib/ai', () => ({ getAIService: vi.fn(() => ({ generateFigureSvg: mocks.generateFigureSvg })) }));
vi.mock('@/lib/ai-quota', () => ({ consumeAiQuota: mocks.consumeAiQuota }));
vi.mock('@/lib/db-write-queue', () => ({ serializeWrite: <T,>(fn: () => Promise<T>) => fn() }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { POST } from '@/app/api/import-tasks/[id]/figure/route';
import { getAIService } from '@/lib/ai';
import { resetBackgroundTasksForTest } from '@/lib/background-tasks';

const parsed = {
    questionText: '求解方程 x + 2 = 5',
    answerText: 'x = 3',
    analysis: '移项得 x = 3',
    knowledgePoints: ['一元一次方程'],
    subject: '数学',
    mistakeStatus: 'unknown',
    wrongAnswerText: '',
    mistakeAnalysis: '',
    requiresImage: false,
    source: '期中考试',
};
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
const call = (body: Record<string, unknown> = {}) => POST(new Request('http://localhost/api/import-tasks/t1/figure', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
}), { params: Promise.resolve({ id: 't1' }) });
const reviewTask = (overrides: Record<string, unknown> = {}) => ({
    status: 'review',
    imageData: 'data:image/png;base64,QUJD',
    result: JSON.stringify(parsed),
    ...overrides,
});

describe('POST /api/import-tasks/:id/figure', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
        mocks.importTask.findMany.mockResolvedValue([]);
        mocks.importTask.findFirst.mockResolvedValue(reviewTask());
        mocks.importTask.updateMany.mockResolvedValue({ count: 1 });
        mocks.consumeAiQuota.mockResolvedValue(null);
        resetBackgroundTasksForTest();
    });

    it('把任务原图和题干交给 AI，配图合并回识别结果', async () => {
        mocks.generateFigureSvg.mockResolvedValue({ hasFigure: true, figureSvg: svg });

        const response = await call();

        expect(response.status).toBe(200);
        expect(mocks.generateFigureSvg).toHaveBeenCalledWith('QUJD', 'image/png', '求解方程 x + 2 = 5');
        // 用量记在发起操作的用户名下
        expect(getAIService).toHaveBeenCalledWith({ userId: 'user-1', kind: 'figure' });
        const update = mocks.importTask.updateMany.mock.calls[0][0];
        expect(update.where).toEqual({ id: 't1', userId: 'user-1', status: 'review' });
        expect(JSON.parse(update.data.result)).toMatchObject({
            questionText: '求解方程 x + 2 = 5', answerText: 'x = 3', source: '期中考试', hasFigure: true, figureSvg: svg,
        });
        expect(await response.json()).toEqual({ hasFigure: true, figureSvg: svg });
    });

    it('优先使用框选的配图区域，而不是整张任务原图', async () => {
        mocks.generateFigureSvg.mockResolvedValue({ hasFigure: true, figureSvg: svg });

        const response = await call({ imageBase64: 'data:image/jpeg;base64,Q0Q=' });

        expect(response.status).toBe(200);
        expect(mocks.generateFigureSvg).toHaveBeenCalledWith('Q0Q=', 'image/jpeg', '求解方程 x + 2 = 5');
    });

    it('他人任务返回 404，非待校对状态返回 409，均不调用 AI', async () => {
        mocks.importTask.findFirst.mockResolvedValueOnce(null);
        const other = await call();
        expect(other.status).toBe(404);
        expect(mocks.generateFigureSvg).not.toHaveBeenCalled();

        mocks.importTask.findFirst.mockResolvedValueOnce(reviewTask({ status: 'saved' }));
        const saved = await call();
        expect(saved.status).toBe(409);
        expect((await saved.json()).message).toBe('IMPORT_TASK_NOT_REVIEWABLE');
        expect(mocks.generateFigureSvg).not.toHaveBeenCalled();
    });

    it('文字任务没有原图时返回 NO_ORIGINAL_IMAGE', async () => {
        mocks.importTask.findFirst.mockResolvedValue(reviewTask({ imageData: '' }));

        const response = await call();

        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('NO_ORIGINAL_IMAGE');
        expect(mocks.generateFigureSvg).not.toHaveBeenCalled();
    });

    it('非法配图裁剪数据返回 400，不读取任务也不调用 AI', async () => {
        const response = await call({ imageBase64: 'data:text/plain;base64,hello' });

        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('INVALID_IMAGE');
        expect(mocks.importTask.findFirst).not.toHaveBeenCalled();
        expect(mocks.generateFigureSvg).not.toHaveBeenCalled();
    });
});
