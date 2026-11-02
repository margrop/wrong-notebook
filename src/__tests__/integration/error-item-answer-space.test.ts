/**
 * PUT /api/error-items/answer-space 集成测试：批量保存错题打印的单题留白
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    errorItem: { updateMany: vi.fn() },
    session: { user: { email: 'user@example.com' }, expires: '2099-01-01' } as { user: { email: string }; expires: string } | null,
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        user: mocks.user,
        errorItem: mocks.errorItem,
        $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    },
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { PUT } from '@/app/api/error-items/answer-space/route';

function put(body: unknown) {
    return PUT(new Request('http://localhost/api/error-items/answer-space', { method: 'PUT', body: JSON.stringify(body) }));
}

describe('PUT /api/error-items/answer-space', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.session = { user: { email: 'user@example.com' }, expires: '2099-01-01' };
        mocks.user.findUnique.mockResolvedValue({ id: 'user-1' });
        mocks.errorItem.updateMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) => Promise.resolve({ count: where.id.in.length }));
    });

    it('按取值合并保存，只更新当前用户的错题', async () => {
        const response = await put({ items: [
            { id: 'a', answerSpacePx: 240 },
            { id: 'b', answerSpacePx: 240 },
            { id: 'c', answerSpacePx: null },
        ] });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ updated: 3 });
        expect(mocks.errorItem.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] }, userId: 'user-1' }, data: { answerSpacePx: 240 } });
        expect(mocks.errorItem.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['c'] }, userId: 'user-1' }, data: { answerSpacePx: null } });
    });

    it.each([
        {},
        { items: [] },
        { items: [{ id: 'a', answerSpacePx: -1 }] },
        { items: [{ id: 'a', answerSpacePx: 601 }] },
        { items: [{ id: 'a', answerSpacePx: 50.5 }] },
        { items: [{ id: 'a', answerSpacePx: '120' }] },
        { items: [{ id: '', answerSpacePx: 120 }] },
    ])('拒绝非法请求 %j', async (body) => {
        expect((await put(body)).status).toBe(400);
        expect(mocks.errorItem.updateMany).not.toHaveBeenCalled();
    });

    it('未登录时返回 401', async () => {
        mocks.session = null;
        expect((await put({ items: [{ id: 'a', answerSpacePx: 120 }] })).status).toBe(401);
    });
});
