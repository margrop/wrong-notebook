/**
 * /api/error-items/:id/svg-animation 集成测试：生成与删除 SVG 动画讲解、补写语音讲解稿；
 * 以及 DELETE /api/error-items/:id/geogebra 删除 GeoGebra 演示
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    errorItem: { findUnique: vi.fn(), update: vi.fn() },
    generateSvgAnimation: vi.fn(),
    generateSvgNarration: vi.fn(),
    analyzeForGeogebra: vi.fn(),
    consumeAiQuota: vi.fn(),
    session: { user: { email: 'user@example.com' }, expires: '2099-01-01' } as { user: { email: string }; expires: string } | null,
}));

vi.mock('@/lib/prisma', () => ({ prisma: { user: mocks.user, errorItem: mocks.errorItem } }));
vi.mock('@/lib/ai', () => ({ getAIService: vi.fn(() => ({ generateSvgAnimation: mocks.generateSvgAnimation, generateSvgNarration: mocks.generateSvgNarration, analyzeForGeogebra: mocks.analyzeForGeogebra })) }));
vi.mock('@/lib/ai-quota', () => ({ consumeAiQuota: mocks.consumeAiQuota }));
vi.mock('@/lib/db-write-queue', () => ({ serializeWrite: (fn: () => Promise<unknown>) => fn() }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { POST, DELETE } from '@/app/api/error-items/[id]/svg-animation/route';
import { DELETE as DELETE_GEOGEBRA, POST as POST_GEOGEBRA } from '@/app/api/error-items/[id]/geogebra/route';
import { POST as POST_NARRATION } from '@/app/api/error-items/[id]/svg-animation/narration/route';
import { resetBackgroundTasksForTest } from '@/lib/background-tasks';

const context = { params: Promise.resolve({ id: 'e1' }) };
const generate = (body?: unknown) => POST(new Request('http://localhost', { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) }), context);
const remove = (query = '') => DELETE(new Request(`http://localhost${query}`, { method: 'DELETE' }), context);
const removeGeogebra = () => DELETE_GEOGEBRA(new Request('http://localhost', { method: 'DELETE' }), context);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"><animate attributeName="r" from="0" to="4" dur="1s"/></circle></svg>';

describe('SVG 动画讲解接口', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1', questionText: '求面积', answerText: '6', analysis: '底乘高', figureSvg: '<svg/>' });
        mocks.errorItem.update.mockResolvedValue({});
        mocks.consumeAiQuota.mockResolvedValue(null);
        resetBackgroundTasksForTest();
    });

    it('POST 把题目、答案、解析和配图交给 AI，未指定语言时生成并保存中文版动画', async () => {
        mocks.generateSvgAnimation.mockResolvedValue(svg);

        const response = await generate();

        expect(response.status).toBe(200);
        expect(mocks.generateSvgAnimation).toHaveBeenCalledWith('求面积', '6', '底乘高', '<svg/>', 'zh');
        expect(mocks.errorItem.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { svgAnimation: svg } });
        expect(await response.json()).toEqual({ svgAnimation: svg, language: 'zh' });
    });

    it('POST language=en 时生成英文版动画，单独保存且不覆盖中文版', async () => {
        mocks.generateSvgAnimation.mockResolvedValue(svg);

        const response = await generate({ language: 'en' });

        expect(response.status).toBe(200);
        expect(mocks.generateSvgAnimation).toHaveBeenCalledWith('求面积', '6', '底乘高', '<svg/>', 'en');
        expect(mocks.errorItem.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { svgAnimationEn: svg } });
        expect(await response.json()).toEqual({ svgAnimation: svg, language: 'en' });
    });

    it('POST 不支持的语言按中文处理', async () => {
        mocks.generateSvgAnimation.mockResolvedValue(svg);

        await generate({ language: 'fr' });

        expect(mocks.generateSvgAnimation.mock.calls[0][4]).toBe('zh');
        expect(mocks.errorItem.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { svgAnimation: svg } });
    });

    it('POST 题目文字为空时返回 NO_QUESTION_TEXT，不调用 AI', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1', questionText: '  ', answerText: null, analysis: null, figureSvg: null });

        const response = await generate();

        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('NO_QUESTION_TEXT');
        expect(mocks.generateSvgAnimation).not.toHaveBeenCalled();
    });

    it('POST AI 未返回有效动画时返回 NO_VALID_ANIMATION，不覆盖已有动画', async () => {
        mocks.generateSvgAnimation.mockResolvedValue(null);

        const response = await generate();

        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('NO_VALID_ANIMATION');
        expect(mocks.errorItem.update).not.toHaveBeenCalled();
    });

    it('POST AI 报错时返回错误码', async () => {
        mocks.generateSvgAnimation.mockRejectedValue(new Error('AI_TIMEOUT_ERROR'));

        const response = await generate();

        expect(response.status).toBe(500);
        expect((await response.json()).message).toBe('AI_TIMEOUT_ERROR');
    });

    it('同一错题同一语言并发两次，第二个返回 409 且只扣一次额度、只调用一次 AI', async () => {
        let finish!: (value: string) => void;
        mocks.generateSvgAnimation.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));

        const first = generate();
        await vi.waitFor(() => expect(mocks.generateSvgAnimation).toHaveBeenCalledTimes(1));

        const second = await generate();
        expect(second.status).toBe(409);
        expect((await second.json()).code).toBe('TASK_ALREADY_RUNNING');
        expect(mocks.consumeAiQuota).toHaveBeenCalledTimes(1);
        expect(mocks.generateSvgAnimation).toHaveBeenCalledTimes(1);

        finish(svg);
        expect((await first).status).toBe(200);
    });

    it('任务结束后可再次发起', async () => {
        mocks.generateSvgAnimation.mockResolvedValue(svg);

        expect((await generate()).status).toBe(200);
        expect((await generate()).status).toBe(200);
        expect(mocks.consumeAiQuota).toHaveBeenCalledTimes(2);
        expect(mocks.generateSvgAnimation).toHaveBeenCalledTimes(2);
    });

    it('额度不足时 cancel 预占，不调用 AI，之后可再次发起', async () => {
        mocks.consumeAiQuota.mockResolvedValueOnce(new Response(null, { status: 429 }));
        mocks.generateSvgAnimation.mockResolvedValue(svg);

        const limited = await generate();
        expect(limited.status).toBe(429);
        expect(mocks.generateSvgAnimation).not.toHaveBeenCalled();

        // 预占已 cancel，可再次发起
        expect((await generate()).status).toBe(200);
        expect(mocks.generateSvgAnimation).toHaveBeenCalledTimes(1);
    });

    it('不同语言互不影响', async () => {
        mocks.generateSvgAnimation.mockResolvedValue(svg);

        expect((await generate({ language: 'zh' })).status).toBe(200);
        expect((await generate({ language: 'en' })).status).toBe(200);
    });

    it('DELETE 未指定语言时清空中文版动画', async () => {
        const response = await remove();

        expect(response.status).toBe(200);
        expect(mocks.errorItem.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { svgAnimation: null } });
    });

    it('DELETE language=en 只清空英文版动画', async () => {
        const response = await remove('?language=en');

        expect(response.status).toBe(200);
        expect(mocks.errorItem.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { svgAnimationEn: null } });
    });

    it('未登录返回 401，不能操作他人的题目', async () => {
        mocks.session = null;
        expect((await generate()).status).toBe(401);
        expect((await remove()).status).toBe(401);

        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'other', questionText: '求面积' });
        expect((await generate()).status).toBe(404);
        expect((await remove()).status).toBe(404);
        expect(mocks.errorItem.update).not.toHaveBeenCalled();
        expect(mocks.generateSvgAnimation).not.toHaveBeenCalled();
    });
});

describe('POST /api/error-items/:id/svg-animation/narration', () => {
    const narrate = (body?: unknown) => POST_NARRATION(new Request('http://localhost', { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) }), context);
    const narration = [{ begin: 0, text: '先看 a<b' }];

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1', questionText: '求面积', answerText: '6', analysis: '底乘高', svgAnimation: svg, svgAnimationEn: null });
        mocks.errorItem.update.mockResolvedValue({});
        mocks.consumeAiQuota.mockResolvedValue(null);
        resetBackgroundTasksForTest();
    });

    it('为中文版动画补写讲解稿，写入 SVG 后保存，画面不变', async () => {
        mocks.generateSvgNarration.mockResolvedValue(narration);

        const response = await narrate();

        expect(response.status).toBe(200);
        expect(mocks.generateSvgNarration).toHaveBeenCalledWith('求面积', '6', '底乘高', svg, 'zh');
        const saved = mocks.errorItem.update.mock.calls[0][0].data.svgAnimation as string;
        expect(saved).toContain('<metadata id="narration">');
        expect(saved).toContain('a&lt;b');
        expect(saved.replace(/<metadata[\s\S]*?<\/metadata>/, '')).toBe(svg);
        expect((await response.json()).svgAnimation).toBe(saved);
    });

    it('英文版动画不存在时返回 NO_ANIMATION，不调用 AI', async () => {
        const response = await narrate({ language: 'en' });

        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('NO_ANIMATION');
        expect(mocks.generateSvgNarration).not.toHaveBeenCalled();
    });

    it('AI 未返回有效讲解稿时返回 NO_VALID_NARRATION，不修改动画', async () => {
        mocks.generateSvgNarration.mockResolvedValue(null);

        const response = await narrate();

        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('NO_VALID_NARRATION');
        expect(mocks.errorItem.update).not.toHaveBeenCalled();
    });

    it('同一错题同一语言并发两次，第二个返回 409 且只扣一次额度、只调用一次 AI', async () => {
        let finish!: (value: unknown) => void;
        mocks.generateSvgNarration.mockReturnValue(new Promise((resolve) => { finish = resolve; }));

        const first = narrate();
        await vi.waitFor(() => expect(mocks.generateSvgNarration).toHaveBeenCalledTimes(1));

        const second = await narrate();
        expect(second.status).toBe(409);
        expect((await second.json()).code).toBe('TASK_ALREADY_RUNNING');
        expect(mocks.consumeAiQuota).toHaveBeenCalledTimes(1);
        expect(mocks.generateSvgNarration).toHaveBeenCalledTimes(1);

        finish(narration);
        expect((await first).status).toBe(200);
    });

    it('任务结束后可再次发起', async () => {
        mocks.generateSvgNarration.mockResolvedValue(narration);

        expect((await narrate()).status).toBe(200);
        expect((await narrate()).status).toBe(200);
        expect(mocks.consumeAiQuota).toHaveBeenCalledTimes(2);
        expect(mocks.generateSvgNarration).toHaveBeenCalledTimes(2);
    });

    it('未登录返回 401，不能操作他人的题目', async () => {
        mocks.session = null;
        expect((await narrate()).status).toBe(401);

        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'other', svgAnimation: svg });
        expect((await narrate()).status).toBe(404);
        expect(mocks.generateSvgNarration).not.toHaveBeenCalled();
    });
});

describe('DELETE /api/error-items/:id/geogebra', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1' });
        mocks.errorItem.update.mockResolvedValue({});
    });

    it('清空已生成的 GeoGebra 命令', async () => {
        const response = await removeGeogebra();

        expect(response.status).toBe(200);
        expect(mocks.errorItem.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { geogebraCommands: null } });
    });

    it('未登录、题目不存在或属于他人时不删除', async () => {
        mocks.session = null;
        expect((await removeGeogebra()).status).toBe(401);

        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.errorItem.findUnique.mockResolvedValue(null);
        expect((await removeGeogebra()).status).toBe(404);

        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'other' });
        expect((await removeGeogebra()).status).toBe(403);
        expect(mocks.errorItem.update).not.toHaveBeenCalled();
    });
});

describe('POST /api/error-items/:id/geogebra', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1', questionText: '求面积', subject: { name: '数学' }, answerText: '6', analysis: '底乘高' });
        mocks.errorItem.update.mockResolvedValue({});
        mocks.consumeAiQuota.mockResolvedValue(null);
        resetBackgroundTasksForTest();
        mocks.analyzeForGeogebra.mockResolvedValue({ suitable: true, commands: ['A=(0,0)'], description: '' });
    });

    const postGeogebra = (body: unknown) => POST_GEOGEBRA(
        new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }),
        context,
    );

    it('非法请求体返回 400', async () => {
        const response = await postGeogebra({ questionText: 123 });
        expect(response.status).toBe(400);
        expect(mocks.analyzeForGeogebra).not.toHaveBeenCalled();
    });

    it('正常请求成功', async () => {
        const response = await postGeogebra({});
        expect(response.status).toBe(200);
        expect(mocks.analyzeForGeogebra).toHaveBeenCalled();
    });

    it('同一错题并发两次，第二个返回 409 且只扣一次额度、只调用一次 AI', async () => {
        let finish!: (value: unknown) => void;
        mocks.analyzeForGeogebra.mockReturnValue(new Promise((resolve) => { finish = resolve; }));

        const first = postGeogebra({});
        await vi.waitFor(() => expect(mocks.analyzeForGeogebra).toHaveBeenCalledTimes(1));

        const second = await postGeogebra({});
        expect(second.status).toBe(409);
        expect((await second.json()).code).toBe('TASK_ALREADY_RUNNING');
        expect(mocks.consumeAiQuota).toHaveBeenCalledTimes(1);
        expect(mocks.analyzeForGeogebra).toHaveBeenCalledTimes(1);

        finish({ suitable: true, commands: ['A=(0,0)'], description: '' });
        expect((await first).status).toBe(200);
    });

    it('任务结束后可再次发起', async () => {
        expect((await postGeogebra({})).status).toBe(200);
        expect((await postGeogebra({})).status).toBe(200);
        expect(mocks.consumeAiQuota).toHaveBeenCalledTimes(2);
        expect(mocks.analyzeForGeogebra).toHaveBeenCalledTimes(2);
    });
});
