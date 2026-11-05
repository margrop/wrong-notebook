/**
 * AI 数据授权集成测试：授权接口，以及未授权时 AI 路由在调用服务商前被拒绝
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 使用真实的授权判断，而不是 setup.ts 中默认已授权的替身
vi.unmock('@/lib/ai-consent-store');

const mocks = vi.hoisted(() => ({
    user: { findUnique: vi.fn(), update: vi.fn() },
    aiUsage: { count: vi.fn(async () => 0), create: vi.fn(async () => ({})) },
    ai: { analyzeForGeogebra: vi.fn() },
    session: { user: { email: 'user@example.com', name: 'Test User', id: 'u1' }, expires: '2099-12-31' },
}));

vi.mock('@/lib/prisma', () => ({ prisma: { user: mocks.user, aiUsage: mocks.aiUsage } }));
vi.mock('@/lib/ai', () => ({ getAIService: vi.fn(() => mocks.ai) }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(() => Promise.resolve(mocks.session)) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { DELETE, POST } from '@/app/api/user/ai-consent/route';
import { POST as geogebraAnalyze } from '@/app/api/geogebra-analyze/route';

const geogebraRequest = () => new Request('http://localhost/api/geogebra-analyze', {
    method: 'POST',
    body: JSON.stringify({ questionText: '求函数 y = x^2 的顶点' }),
    headers: { 'Content-Type': 'application/json' },
});

describe('AI 数据授权', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('POST 记录授权时间，DELETE 撤回授权', async () => {
        mocks.user.findUnique.mockResolvedValue({ id: 'u1', role: 'user', aiDataConsentAt: null });
        const consentAt = new Date('2026-11-05T00:00:00Z');
        mocks.user.update.mockResolvedValueOnce({ aiDataConsentAt: consentAt }).mockResolvedValueOnce({ aiDataConsentAt: null });

        const granted = await POST();
        expect(granted.status).toBe(200);
        expect(await granted.json()).toEqual({ aiDataConsentAt: consentAt.toISOString() });
        expect(mocks.user.update.mock.calls[0][0]).toMatchObject({ where: { id: 'u1' }, data: { aiDataConsentAt: expect.any(Date) } });

        const revoked = await DELETE();
        expect(await revoked.json()).toEqual({ aiDataConsentAt: null });
        expect(mocks.user.update.mock.calls[1][0]).toMatchObject({ where: { id: 'u1' }, data: { aiDataConsentAt: null } });
    });

    it('未登录时授权接口返回 401', async () => {
        mocks.user.findUnique.mockResolvedValue(null);
        expect((await POST()).status).toBe(401);
        expect(mocks.user.update).not.toHaveBeenCalled();
    });

    it('未授权时 AI 路由返回 403，不调用 AI 服务商、不计用量', async () => {
        mocks.user.findUnique.mockResolvedValue({ id: 'u1', role: 'user', aiDataConsentAt: null });

        const response = await geogebraAnalyze(geogebraRequest());

        expect(response.status).toBe(403);
        expect((await response.json()).code).toBe('AI_CONSENT_REQUIRED');
        expect(mocks.ai.analyzeForGeogebra).not.toHaveBeenCalled();
        expect(mocks.aiUsage.create).not.toHaveBeenCalled();
    });

    it('已授权时 AI 路由正常调用', async () => {
        mocks.user.findUnique.mockResolvedValue({ id: 'u1', role: 'user', aiDataConsentAt: new Date() });
        mocks.ai.analyzeForGeogebra.mockResolvedValue({ suitable: true, commands: ['f(x)=x^2'], description: '抛物线' });

        const response = await geogebraAnalyze(geogebraRequest());

        expect(response.status).toBe(200);
        expect(mocks.ai.analyzeForGeogebra).toHaveBeenCalledTimes(1);
    });
});
