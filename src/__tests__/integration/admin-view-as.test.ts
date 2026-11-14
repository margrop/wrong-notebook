/**
 * /api/admin/view-as 集成测试
 * 管理员查看他人数据时设置 cookie，普通接口按目标用户执行。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    cookieValue: undefined as string | undefined,
    cookieStore: {
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
    },
    userFindUnique: vi.fn(),
    session: { user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'admin' }, expires: '2099-01-01' },
}));

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => mocks.cookieStore) }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/eula/server', () => ({ isEulaPending: vi.fn(() => false) }));
vi.mock('@/lib/logger', () => ({
    createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/lib/prisma', () => ({
    prisma: { user: { findUnique: mocks.userFindUnique } },
}));

import { GET, POST, DELETE } from '@/app/api/admin/view-as/route';
import { withUser } from '@/lib/api-handler';

const adminRow = { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'admin' };
const targetRow = { id: 'child-1', email: 'child@example.com', name: 'Child', role: 'user' };

describe('/api/admin/view-as', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.cookieValue = undefined;
        mocks.cookieStore.get.mockImplementation(() => mocks.cookieValue ? { value: mocks.cookieValue } : undefined);
        mocks.userFindUnique.mockImplementation(({ where }) => {
            if (where.email === 'admin@example.com' || where.id === 'admin-1') return Promise.resolve(adminRow);
            if (where.id === 'child-1') return Promise.resolve(targetRow);
            return Promise.resolve(null);
        });
    });

    it('设置查看目标后读取返回目标用户', async () => {
        const post = await POST(new Request('http://localhost/api/admin/view-as', {
            method: 'POST',
            body: JSON.stringify({ userId: 'child-1' }),
            headers: { 'Content-Type': 'application/json' },
        }));
        expect(post.status).toBe(200);
        expect(mocks.cookieStore.set).toHaveBeenCalledWith('wn_admin_view_as', 'child-1', expect.objectContaining({ httpOnly: true }));

        mocks.cookieValue = 'child-1';
        const get = await GET(new Request('http://localhost/api/admin/view-as'));
        expect(await get.json()).toMatchObject({ target: { id: 'child-1', name: 'Child', email: 'child@example.com' } });
    });

    it('普通接口按查看目标解析当前用户', async () => {
        mocks.cookieValue = 'child-1';
        const route = withUser(async (_req, { user }) => Response.json({ id: user.id }));
        const response = await route(new Request('http://localhost/api/notebooks'));
        expect(await response.json()).toEqual({ id: 'child-1' });
    });

    it('退出查看时删除 cookie', async () => {
        const response = await DELETE(new Request('http://localhost/api/admin/view-as', { method: 'DELETE' }));
        expect(response.status).toBe(200);
        expect(mocks.cookieStore.delete).toHaveBeenCalledWith('wn_admin_view_as');
    });

    it('目标用户不存在时拒绝设置', async () => {
        const response = await POST(new Request('http://localhost/api/admin/view-as', {
            method: 'POST',
            body: JSON.stringify({ userId: 'missing' }),
            headers: { 'Content-Type': 'application/json' },
        }));
        expect(response.status).toBe(400);
        expect(mocks.cookieStore.set).not.toHaveBeenCalled();
    });
});
