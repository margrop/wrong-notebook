/**
 * 后台任务查询接口 /api/tasks，以及生成接口登记事务、替换原题图片接口
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    errorItem: { findUnique: vi.fn(), update: vi.fn() },
    generateSvgAnimation: vi.fn(),
    session: { user: { email: 'user@example.com' }, expires: '2099-01-01' } as { user: { email: string }; expires: string } | null,
}));

vi.mock('@/lib/prisma', () => ({ prisma: { user: mocks.user, errorItem: mocks.errorItem } }));
vi.mock('@/lib/ai', () => ({ getAIService: vi.fn(() => ({ generateSvgAnimation: mocks.generateSvgAnimation })) }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET, DELETE } from '@/app/api/tasks/route';
import { POST as GENERATE } from '@/app/api/error-items/[id]/svg-animation/route';
import { GET as READ_IMAGE, PUT as REPLACE_IMAGE } from '@/app/api/error-items/[id]/image/route';
import { resetBackgroundTasksForTest, startBackgroundTask } from '@/lib/background-tasks';

const context = { params: Promise.resolve({ id: 'e1' }) };
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"><animate attributeName="r" dur="1s"/></circle></svg>';

beforeEach(() => {
    vi.clearAllMocks();
    resetBackgroundTasksForTest();
    mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
    mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
    mocks.errorItem.update.mockResolvedValue({});
});

describe('/api/tasks', () => {
    it('生成动画讲解期间显示为进行中，完成后显示已完成', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1', shortId: 'hA6PB9', questionText: '求三角形面积', answerText: '6', analysis: '', figureSvg: null });
        let finish!: (value: string) => void;
        mocks.generateSvgAnimation.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));

        const generating = GENERATE(new Request('http://localhost', { method: 'POST' }), context);
        await vi.waitFor(() => expect(mocks.generateSvgAnimation).toHaveBeenCalled());

        const running = await (await GET()).json();
        expect(running.tasks).toMatchObject([{ kind: 'svg_animation', status: 'running', subject: 'hA6PB9 求三角形面积', link: '/error-items/e1' }]);

        finish(svg);
        expect((await generating).status).toBe(200);
        expect((await (await GET()).json()).tasks[0].status).toBe('succeeded');
    });

    it('AI 未返回有效动画时事务标记为失败', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1', shortId: 'x1', questionText: '题', answerText: '', analysis: '', figureSvg: null });
        mocks.generateSvgAnimation.mockResolvedValue(null);

        expect((await GENERATE(new Request('http://localhost', { method: 'POST' }), context)).status).toBe(400);
        expect((await (await GET()).json()).tasks[0]).toMatchObject({ status: 'failed', error: 'NO_VALID_ANIMATION' });
    });

    it('只返回本人的事务；DELETE 清除已结束的', async () => {
        startBackgroundTask({ userId: 'other', kind: 'analyze' });
        startBackgroundTask({ userId: 'user-1', kind: 'figure' }).succeed();
        startBackgroundTask({ userId: 'user-1', kind: 'exam', total: 2 });

        expect((await (await GET()).json()).tasks.map((task: { kind: string }) => task.kind)).toEqual(['exam', 'figure']);
        expect((await (await DELETE()).json()).tasks.map((task: { kind: string }) => task.kind)).toEqual(['exam']);
    });

    it('返回中包含 target 字段（按目标防重复）', async () => {
        startBackgroundTask({ userId: 'user-1', kind: 'fix_text', target: 'import-batch:abc:fix-text' }).succeed();
        startBackgroundTask({ userId: 'user-1', kind: 'fix_text' });

        const tasks = (await (await GET()).json()).tasks as Array<{ kind: string; target: string | null; status: string }>;
        expect(tasks.find((task) => task.status === 'succeeded')?.target).toBe('import-batch:abc:fix-text');
        expect(tasks.find((task) => task.status === 'running')?.target).toBeNull();
    });

    it('未登录返回 401', async () => {
        mocks.session = null;
        expect((await GET()).status).toBe(401);
        expect((await DELETE()).status).toBe(401);
    });
});

describe('PUT /api/error-items/:id/image', () => {
    const put = (body: unknown) => REPLACE_IMAGE(new Request('http://localhost', { method: 'PUT', body: JSON.stringify(body) }), context);
    const image = 'data:image/jpeg;base64,QUJDRA==';

    it('替换为新的原题图片', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1' });

        const response = await put({ imageDataUrl: image });

        expect(response.status).toBe(200);
        expect(mocks.errorItem.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { originalImageUrl: image } });
    });

    it.each([
        { imageDataUrl: 'https://evil.example/a.png' },
        { imageDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
        { imageDataUrl: 'data:text/html;base64,PGh0bWw+' },
        {},
    ])('拒绝非图片 data URL：%o', async (body) => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1' });
        const response = await put(body);
        expect(response.status).toBe(400);
        expect((await response.json()).message).toBe('INVALID_IMAGE');
        expect(mocks.errorItem.update).not.toHaveBeenCalled();
    });

    it('不能替换他人题目的图片，未登录返回 401', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'other' });
        expect((await put({ imageDataUrl: image })).status).toBe(404);
        mocks.session = null;
        expect((await put({ imageDataUrl: image })).status).toBe(401);
        expect(mocks.errorItem.update).not.toHaveBeenCalled();
    });
});

describe('GET /api/error-items/:id/image', () => {
    const read = () => READ_IMAGE(new Request('http://localhost/api/error-items/e1/image'), context);

    it('以二进制输出本人的原图并允许长期缓存', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1', originalImageUrl: 'data:image/jpeg;base64,QUJDRA==' });
        const response = await read();
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/jpeg');
        expect(response.headers.get('cache-control')).toContain('private');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('ABCD');
    });

    it('不输出 SVG、HTML 等非位图内容', async () => {
        for (const originalImageUrl of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGh0bWw+', '']) {
            mocks.errorItem.findUnique.mockResolvedValue({ userId: 'user-1', originalImageUrl });
            expect((await read()).status).toBe(404);
        }
    });

    it('他人的题目返回 404，未登录返回 401', async () => {
        mocks.errorItem.findUnique.mockResolvedValue({ userId: 'other', originalImageUrl: 'data:image/png;base64,QUJDRA==' });
        expect((await read()).status).toBe(404);
        mocks.session = null;
        expect((await read()).status).toBe(401);
    });
});
