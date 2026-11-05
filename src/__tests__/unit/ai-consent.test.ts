import { beforeEach, describe, expect, it, vi } from 'vitest';

// 本文件验证授权本身，使用真实实现而不是 setup.ts 中默认已授权的替身
vi.unmock('@/lib/ai-consent-store');

const mocks = vi.hoisted(() => ({
    aiUsage: { count: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn() },
    config: { aiDailyLimit: 0 } as { aiDailyLimit?: number },
}));

vi.mock('@/lib/prisma', () => ({ prisma: { aiUsage: mocks.aiUsage, user: mocks.user } }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => mocks.config, getAppTimeZone: () => 'Asia/Shanghai' }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { aiProviderDisplayName, isAiConsentRequired, requestAiConsent, subscribeAiConsentRequest } from '@/lib/ai-consent';
import { hasAiDataConsent } from '@/lib/ai-consent-store';
import { consumeAiQuota, quotaRejectionCode } from '@/lib/ai-quota';
import { apiClient } from '@/lib/api-client';

describe('AI 数据授权（服务端）', () => {
    beforeEach(() => {
        mocks.config = { aiDailyLimit: 0 };
        mocks.aiUsage.count.mockResolvedValue(0);
        mocks.aiUsage.create.mockResolvedValue({});
    });

    it('传入授权时间时直接判断，不查数据库', async () => {
        await expect(hasAiDataConsent({ id: 'u1', aiDataConsentAt: new Date() })).resolves.toBe(true);
        await expect(hasAiDataConsent({ id: 'u1', aiDataConsentAt: null })).resolves.toBe(false);
        expect(mocks.user.findUnique).not.toHaveBeenCalled();
    });

    it('未传入授权时间时从数据库读取', async () => {
        mocks.user.findUnique.mockResolvedValue({ aiDataConsentAt: new Date() });
        await expect(hasAiDataConsent({ id: 'u1' })).resolves.toBe(true);
        expect(mocks.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { aiDataConsentAt: true } });
    });

    it('未授权时返回 403 AI_CONSENT_REQUIRED，不记录用量（管理员也一样）', async () => {
        const response = await consumeAiQuota({ id: 'admin', role: 'admin', aiDataConsentAt: null }, 'analyze');

        expect(response?.status).toBe(403);
        await expect(quotaRejectionCode(response!)).resolves.toBe('AI_CONSENT_REQUIRED');
        expect((await response!.json()).code).toBe('AI_CONSENT_REQUIRED');
        expect(mocks.aiUsage.create).not.toHaveBeenCalled();
    });

    it('读取授权失败时拒绝调用', async () => {
        mocks.user.findUnique.mockRejectedValue(new Error('database unavailable'));

        const response = await consumeAiQuota({ id: 'u1' }, 'analyze');

        expect(response?.status).toBe(403);
        expect(mocks.aiUsage.create).not.toHaveBeenCalled();
    });

    it('已授权时按原逻辑检查额度并记录用量', async () => {
        await expect(consumeAiQuota({ id: 'u1', aiDataConsentAt: new Date() }, 'analyze')).resolves.toBeNull();
        expect(mocks.aiUsage.create).toHaveBeenCalledWith({ data: { userId: 'u1', kind: 'analyze' } });

        mocks.config = { aiDailyLimit: 1 };
        mocks.aiUsage.count.mockResolvedValue(1);
        const limited = await consumeAiQuota({ id: 'u1', role: 'user', aiDataConsentAt: new Date() }, 'analyze');
        expect(limited?.status).toBe(429);
        await expect(quotaRejectionCode(limited!)).resolves.toBe('AI_DAILY_LIMIT_EXCEEDED');
    });
});

describe('AI 数据授权（前端）', () => {
    it('识别未授权错误体', () => {
        expect(isAiConsentRequired({ code: 'AI_CONSENT_REQUIRED' })).toBe(true);
        expect(isAiConsentRequired({ code: 'AI_DAILY_LIMIT_EXCEEDED' })).toBe(false);
        expect(isAiConsentRequired(null)).toBe(false);
    });

    it('服务商名称：内置渠道、国产预设与未知渠道', () => {
        expect(aiProviderDisplayName('gemini', 'zh')).toBe('Google Gemini');
        expect(aiProviderDisplayName('glm', 'zh')).toBe('智谱 GLM');
        expect(aiProviderDisplayName('glm', 'en')).toBe('Zhipu GLM');
        expect(aiProviderDisplayName('unknown', 'zh')).toBeNull();
        expect(aiProviderDisplayName(undefined, 'zh')).toBeNull();
    });

    it('apiClient 收到未授权的 403 时请求弹出授权窗口', async () => {
        const listener = vi.fn();
        const unsubscribe = subscribeAiConsentRequest(listener);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'AI_CONSENT_REQUIRED', code: 'AI_CONSENT_REQUIRED' }), { status: 403 })));
        try {
            await expect(apiClient.post('/api/analyze', {})).rejects.toMatchObject({ status: 403 });
            expect(listener).toHaveBeenCalledWith('blocked');
        } finally {
            unsubscribe();
            vi.unstubAllGlobals();
        }
    });

    it('其他 403 不弹出授权窗口', async () => {
        const listener = vi.fn();
        const unsubscribe = subscribeAiConsentRequest(listener);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Forbidden', code: 'FORBIDDEN' }), { status: 403 })));
        try {
            await expect(apiClient.get('/api/admin/users')).rejects.toMatchObject({ status: 403 });
            expect(listener).not.toHaveBeenCalled();
            requestAiConsent('prompt');
            expect(listener).toHaveBeenCalledWith('prompt');
        } finally {
            unsubscribe();
            vi.unstubAllGlobals();
        }
    });
});
