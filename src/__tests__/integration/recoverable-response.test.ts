/**
 * 耗时请求响应暂存：withRecoverableResponse 与 GET /api/requests/:id
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    session: { user: { email: 'user@example.com' }, expires: '2099-01-01' } as { user: { email: string }; expires: string } | null,
}));

vi.mock('@/lib/prisma', () => ({ prisma: { user: mocks.user } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from '@/app/api/requests/[id]/route';
import { resetRecoverableResponsesForTest, withRecoverableResponse } from '@/lib/recoverable-response';

const id = 'a'.repeat(32);
const lookup = (requestId = id) => GET(new Request('http://localhost'), { params: Promise.resolve({ id: requestId }) });
const call = (handler: (req: Request) => Promise<Response>, headers: Record<string, string> = { 'X-Request-Id': id }) =>
    withRecoverableResponse(handler)(new Request('http://localhost', { method: 'POST', headers }));

describe('耗时请求响应暂存', () => {
    beforeEach(() => {
        resetRecoverableResponsesForTest();
        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
    });

    it('处理中返回 running，结束后返回原响应的状态码与内容，原响应不受影响', async () => {
        let finish!: () => void;
        const pending = call(() => new Promise((resolve) => { finish = () => resolve(NextResponse.json({ svgAnimation: '<svg/>' })); }));

        expect(await (await lookup()).json()).toEqual({ state: 'running' });

        finish();
        const response = await pending;
        expect(await response.json()).toEqual({ svgAnimation: '<svg/>' });
        expect(await (await lookup()).json()).toEqual({ state: 'done', status: 200, body: { svgAnimation: '<svg/>' } });
    });

    it('保存错误响应，供前端按原错误处理', async () => {
        await call(async () => NextResponse.json({ message: 'NO_VALID_NARRATION' }, { status: 400 }));
        expect(await (await lookup()).json()).toEqual({ state: 'done', status: 400, body: { message: 'NO_VALID_NARRATION' } });
    });

    it('没有或无效的请求编号时不暂存；处理函数抛错时删除登记', async () => {
        await call(async () => NextResponse.json({}), {});
        await call(async () => NextResponse.json({}), { 'X-Request-Id': 'not-valid' });
        expect((await lookup()).status).toBe(404);

        await expect(call(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        expect((await lookup()).status).toBe(404);
        expect((await lookup('../x')).status).toBe(404);
    });

    it('未登录不能查询', async () => {
        await call(async () => NextResponse.json({ ok: true }));
        mocks.session = null;
        expect((await lookup()).status).toBe(401);
    });
});
