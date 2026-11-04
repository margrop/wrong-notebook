import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localStorageMock } from '../setup';

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('apiClient 每日 AI 次数用完提示', () => {
    it('语言为 zh 时显示中文提示', async () => {
        vi.resetModules();
        const { apiClient } = await import('@/lib/api-client');
        const { subscribeFeedback } = await import('@/lib/feedback');
        localStorageMock.setItem('app-language', 'zh');
        fetchMock.mockResolvedValue(json(429, { code: 'AI_DAILY_LIMIT_EXCEEDED' }));

        const warnings: string[] = [];
        const unsubscribe = subscribeFeedback((state) => {
            warnings.push(...state.toasts.filter((t) => t.type === 'warning').map((t) => t.message));
        });

        await expect(apiClient.post('/api/x', {})).rejects.toMatchObject({ status: 429 });
        unsubscribe();
        expect(warnings).toEqual(['今天的 AI 使用次数已达上限，请明天再试，或请管理员调整额度。']);
    });

    it('语言为 en 时显示英文提示', async () => {
        vi.resetModules();
        const { apiClient } = await import('@/lib/api-client');
        const { subscribeFeedback } = await import('@/lib/feedback');
        localStorageMock.setItem('app-language', 'en');
        fetchMock.mockResolvedValue(json(429, { code: 'AI_DAILY_LIMIT_EXCEEDED' }));

        const warnings: string[] = [];
        const unsubscribe = subscribeFeedback((state) => {
            warnings.push(...state.toasts.filter((t) => t.type === 'warning').map((t) => t.message));
        });

        await expect(apiClient.post('/api/x', {})).rejects.toMatchObject({ status: 429 });
        unsubscribe();
        expect(warnings).toEqual(["You have used up today's AI allowance. Try again tomorrow or ask an administrator to raise the limit."]);
    });
});
