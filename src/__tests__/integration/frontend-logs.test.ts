/**
 * /api/logs/frontend 集成测试：登录校验与日志数量、长度限制
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), box: vi.fn(), divider: vi.fn() },
}));

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/logger', () => ({ createLogger: vi.fn(() => mocks.logger) }));
vi.mock('@/lib/prisma', () => ({
    prisma: {
        user: { findUnique: vi.fn(async () => ({ id: 'user-1', email: 'u@localhost' })) },
    },
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/logs/frontend/route';

function makeRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/logs/frontend', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('POST /api/logs/frontend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue({ user: { id: 'user-1', email: 'u@localhost' }, expires: '2099-01-01' });
    });

    it('未登录时返回 401，不写日志', async () => {
        mocks.getServerSession.mockResolvedValue(null);

        const response = await POST(makeRequest({ level: 'error', prefix: '[x]', message: 'spam' }));

        expect(response.status).toBe(401);
        expect(mocks.logger.error).not.toHaveBeenCalled();
    });

    it('记录日志时带上当前用户 ID，且不能被前端 context 覆盖', async () => {
        await POST(makeRequest({ level: 'warn', prefix: '[x]', message: 'hello', context: { userId: 'fake' } }));

        expect(mocks.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), 'hello');
    });

    it('单次最多记录 50 条，单条消息截断到 2000 字符', async () => {
        const logs = Array.from({ length: 80 }, () => ({ level: 'info', prefix: '[x]', message: 'a'.repeat(5000) }));

        const response = await POST(makeRequest({ logs }));

        expect((await response.json()).count).toBe(50);
        expect(mocks.logger.info).toHaveBeenCalledTimes(50);
        expect(mocks.logger.info.mock.calls[0][1]).toHaveLength(2000);
    });

    it('非法请求体返回 400', async () => {
        const response = await POST(makeRequest(null));

        expect(response.status).toBe(400);
        expect(mocks.logger.info).not.toHaveBeenCalled();
    });
});
