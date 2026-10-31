/**
 * 登录、注册失败限流：计数、锁定、过期与客户端 IP 识别
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from 'next-auth';

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(),
    compare: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
vi.mock('@next-auth/prisma-adapter', () => ({ PrismaAdapter: vi.fn(() => ({})) }));
vi.mock('bcryptjs', () => ({ compare: mocks.compare }));
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

import { RateLimiter, getClientIp, loginAccountLimiter, loginIpLimiter } from '@/lib/rate-limit';
import { TOO_MANY_ATTEMPTS } from '@/lib/auth-errors';
import { authOptions } from '@/lib/auth';

type AuthorizeFn = (credentials: Record<string, string>, req: { headers: Record<string, string> }) => Promise<User | null>;
const authorize = (authOptions.providers[0] as unknown as { options: { authorize: AuthorizeFn } }).options.authorize;

describe('RateLimiter', () => {
    it('达到上限后锁定，窗口过期后自动解除', () => {
        let now = 1_000;
        const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 }, () => now);

        expect(limiter.hit('k')).toBe(false);
        expect(limiter.hit('k')).toBe(false);
        expect(limiter.retryAfter('k')).toBe(0);
        expect(limiter.hit('k')).toBe(true);
        expect(limiter.retryAfter('k')).toBe(60_000);

        now += 30_000;
        expect(limiter.retryAfter('k')).toBe(30_000);
        now += 30_000;
        expect(limiter.retryAfter('k')).toBe(0);
        expect(limiter.hit('k')).toBe(false);
    });

    it('不同 key 分别计数，reset 清空计数', () => {
        const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
        limiter.hit('a');
        expect(limiter.retryAfter('a')).toBeGreaterThan(0);
        expect(limiter.retryAfter('b')).toBe(0);
        limiter.reset('a');
        expect(limiter.retryAfter('a')).toBe(0);
    });
});

describe('getClientIp', () => {
    it('依次取 Cloudflare、x-real-ip、x-forwarded-for 的第一个地址', () => {
        expect(getClientIp(new Headers({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '2.2.2.2' }))).toBe('1.1.1.1');
        expect(getClientIp({ 'x-real-ip': '2.2.2.2' })).toBe('2.2.2.2');
        expect(getClientIp({ 'x-forwarded-for': ' 3.3.3.3, 10.0.0.1' })).toBe('3.3.3.3');
        expect(getClientIp(undefined)).toBe('unknown');
    });
});

describe('登录失败锁定', () => {
    const userRow = { id: 'u1', email: 'kid@example.com', name: 'Kid', role: 'user', isActive: true, password: 'hashed' };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findUnique.mockResolvedValue(userRow);
        loginAccountLimiter.reset('kid@example.com');
        loginIpLimiter.reset('9.9.9.9');
    });

    it('同一账号密码错 5 次后，即使密码正确也拒绝，且不再校验密码', async () => {
        mocks.compare.mockResolvedValue(false);
        const req = { headers: { 'x-real-ip': '9.9.9.9' } };
        for (let i = 0; i < 5; i++) {
            await expect(authorize({ email: 'kid@example.com', password: 'wrong' }, req)).resolves.toBeNull();
        }

        mocks.compare.mockClear();
        mocks.compare.mockResolvedValue(true);
        // 邮箱大小写不同也算同一账号
        await expect(authorize({ email: 'Kid@Example.com', password: 'right' }, req)).rejects.toThrow(TOO_MANY_ATTEMPTS);
        expect(mocks.compare).not.toHaveBeenCalled();
    });

    it('登录成功后清零账号的失败次数', async () => {
        const req = { headers: { 'x-real-ip': '9.9.9.9' } };
        mocks.compare.mockResolvedValue(false);
        for (let i = 0; i < 4; i++) await authorize({ email: 'kid@example.com', password: 'wrong' }, req);

        mocks.compare.mockResolvedValue(true);
        await expect(authorize({ email: 'kid@example.com', password: 'right' }, req)).resolves.toMatchObject({ id: 'u1' });

        mocks.compare.mockResolvedValue(false);
        await expect(authorize({ email: 'kid@example.com', password: 'wrong' }, req)).resolves.toBeNull();
        expect(loginAccountLimiter.retryAfter('kid@example.com')).toBe(0);
    });

    it('不存在的账号也计入来源 IP 的失败次数', async () => {
        mocks.findUnique.mockResolvedValue(null);
        const req = { headers: { 'x-real-ip': '9.9.9.9' } };
        for (let i = 0; i < 20; i++) {
            await authorize({ email: `nobody${i}@example.com`, password: 'x' }, req);
        }
        await expect(authorize({ email: 'kid@example.com', password: 'right' }, req)).rejects.toThrow(TOO_MANY_ATTEMPTS);
    });
});
