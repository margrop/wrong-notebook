/**
 * api-handler 单元测试
 * 测试 withUser / withAdmin 的鉴权、异常处理与动态路由参数透传
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    userFindUnique: vi.fn(),
    isEulaPending: vi.fn(() => false),
}));

vi.mock('@/lib/eula/server', () => ({ isEulaPending: mocks.isEulaPending }));

vi.mock('next-auth', () => ({
    getServerSession: mocks.getServerSession,
}));

vi.mock('@/lib/auth', () => ({
    authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        user: {
            findUnique: mocks.userFindUnique,
        },
    },
}));

import { withUser, withAdmin } from '@/lib/api-handler';
import { withRecoverableResponse, resetRecoverableResponsesForTest, getStoredResponse } from '@/lib/recoverable-response';

const loggedInSession = {
    user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
        role: 'user',
    },
    expires: '2099-01-01',
};

const adminSession = {
    user: {
        id: 'admin-1',
        email: 'admin@localhost',
        name: 'Admin',
        role: 'admin',
    },
    expires: '2099-01-01',
};

const existingUser = {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Test User',
    role: 'user',
};

const adminUser = {
    id: 'admin-1',
    email: 'admin@localhost',
    name: 'Admin',
    role: 'admin',
};

describe('withUser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('未登录时返回 401', async () => {
        mocks.getServerSession.mockResolvedValue(null);
        const handler = vi.fn();
        const wrapped = withUser(handler);

        const response = await wrapped(new Request('http://localhost/api/test'));

        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.message).toBe('Authentication required');
        expect(handler).not.toHaveBeenCalled();
    });

    it('session 有邮箱但用户不存在时返回 401', async () => {
        mocks.getServerSession.mockResolvedValue(loggedInSession);
        mocks.userFindUnique.mockResolvedValue(null);
        const handler = vi.fn();
        const wrapped = withUser(handler);

        const response = await wrapped(new Request('http://localhost/api/test'));

        expect(response.status).toBe(401);
        expect(handler).not.toHaveBeenCalled();
    });

    it('已登录用户正常执行 handler 并传入 user 与 session', async () => {
        mocks.getServerSession.mockResolvedValue(loggedInSession);
        mocks.userFindUnique.mockResolvedValue(existingUser);
        const handler = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
        const wrapped = withUser(handler);

        const response = await wrapped(new Request('http://localhost/api/test'));

        expect(response.status).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
        const [req, ctx] = handler.mock.calls[0];
        expect(ctx.user).toEqual(existingUser);
        expect(ctx.session).toEqual(loggedInSession);
        expect(req).toBeInstanceOf(Request);
    });

    it('handler 抛错时返回 500 且响应体结构兼容', async () => {
        mocks.getServerSession.mockResolvedValue(loggedInSession);
        mocks.userFindUnique.mockResolvedValue(existingUser);
        const handler = vi.fn().mockRejectedValue(new Error('database connection failed'));
        const wrapped = withUser(handler);

        const response = await wrapped(new Request('http://localhost/api/test'));

        expect(response.status).toBe(500);
        const data = await response.json();
        expect(data.message).toBe('Internal server error');
        expect(data.code).toBe('INTERNAL_ERROR');
    });

    it('动态路由 params 透传给 handler', async () => {
        mocks.getServerSession.mockResolvedValue(loggedInSession);
        mocks.userFindUnique.mockResolvedValue(existingUser);
        const handler = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
        const wrapped = withUser(handler);

        const params = Promise.resolve({ id: 'item-123' });
        await wrapped(new Request('http://localhost/api/items/item-123'), { params });

        expect(handler).toHaveBeenCalledTimes(1);
        const [, ctx] = handler.mock.calls[0];
        expect(ctx.params).toBe(params);
    });
});

describe('withAdmin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('非管理员访问时返回 403', async () => {
        mocks.getServerSession.mockResolvedValue(loggedInSession);
        mocks.userFindUnique.mockResolvedValue(existingUser);
        const handler = vi.fn();
        const wrapped = withAdmin(handler);

        const response = await wrapped(new Request('http://localhost/api/admin/test'));

        expect(response.status).toBe(403);
        const data = await response.json();
        expect(data.message).toBe('Admin access required');
        expect(handler).not.toHaveBeenCalled();
    });

    it('未登录访问 withAdmin 时返回 401', async () => {
        mocks.getServerSession.mockResolvedValue(null);
        const handler = vi.fn();
        const wrapped = withAdmin(handler);

        const response = await wrapped(new Request('http://localhost/api/admin/test'));

        expect(response.status).toBe(401);
        expect(handler).not.toHaveBeenCalled();
    });

    it('管理员正常执行 handler', async () => {
        mocks.getServerSession.mockResolvedValue(adminSession);
        mocks.userFindUnique.mockResolvedValue(adminUser);
        const handler = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
        const wrapped = withAdmin(handler);

        const response = await wrapped(new Request('http://localhost/api/admin/test'));

        expect(response.status).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
        const [, ctx] = handler.mock.calls[0];
        expect(ctx.user).toEqual(adminUser);
        expect(ctx.session).toEqual(adminSession);
    });

    it('管理员判定与 isAdmin 一致：session.user.role === admin', async () => {
        // session 中 role 为 admin，但数据库中 role 为 user（数据不一致的边缘场景）
        // 按 session 判定（与现有 requireAdmin 一致）
        mocks.getServerSession.mockResolvedValue(adminSession);
        mocks.userFindUnique.mockResolvedValue({ ...adminUser, role: 'user' });
        const handler = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
        const wrapped = withAdmin(handler);

        const response = await wrapped(new Request('http://localhost/api/admin/test'));

        expect(response.status).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('withAdmin 的协议升级门禁', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue(adminSession);
        mocks.userFindUnique.mockResolvedValue(adminUser);
    });

    it('协议待重新同意时，写操作返回 409 EULA_PENDING，GET 不受影响', async () => {
        mocks.isEulaPending.mockReturnValue(true);
        const handler = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
        const wrapped = withAdmin(handler);

        const post = await wrapped(new Request('http://localhost/api/admin/test', { method: 'POST' }));
        expect(post.status).toBe(409);
        expect(await post.json()).toMatchObject({ code: 'EULA_PENDING' });
        expect((await wrapped(new Request('http://localhost/api/admin/test'))).status).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('同意接口（allowEulaPending）不被拦截；普通用户路由不受影响', async () => {
        mocks.isEulaPending.mockReturnValue(true);
        const handler = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
        expect((await withAdmin(handler, { allowEulaPending: true })(new Request('http://localhost/x', { method: 'POST' }))).status).toBe(200);
        expect((await withUser(handler)(new Request('http://localhost/x', { method: 'DELETE' }))).status).toBe(200);
    });

    it('读取协议状态出错时不拦截', async () => {
        mocks.isEulaPending.mockImplementation(() => { throw new Error('config broken'); });
        const handler = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
        expect((await withAdmin(handler)(new Request('http://localhost/x', { method: 'PUT' }))).status).toBe(200);
        mocks.isEulaPending.mockReset();
        mocks.isEulaPending.mockReturnValue(false);
    });
});

describe('withUser 与 withRecoverableResponse 组合', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetRecoverableResponsesForTest();
    });

    it('先 withUser 再 withRecoverableResponse：鉴权失败不暂存，成功时暂存响应', async () => {
        mocks.getServerSession.mockResolvedValue(loggedInSession);
        mocks.userFindUnique.mockResolvedValue(existingUser);

        const handler = withUser(async () => {
            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });

        // 组合顺序：withRecoverableResponse(withUser(handler))
        const wrapped = withRecoverableResponse(handler);

        // 未登录时不暂存
        mocks.getServerSession.mockResolvedValue(null);
        const unauthResponse = await wrapped(new Request('http://localhost/api/test'));
        expect(unauthResponse.status).toBe(401);

        // 已登录时暂存响应
        mocks.getServerSession.mockResolvedValue(loggedInSession);
        const requestId = 'a'.repeat(32);
        const okResponse = await wrapped(new Request('http://localhost/api/test', {
            headers: { 'x-request-id': requestId },
        }));
        expect(okResponse.status).toBe(200);

        const stored = getStoredResponse(requestId);
        expect(stored).toEqual({ state: 'done', status: 200, body: { ok: true } });
    });
});
