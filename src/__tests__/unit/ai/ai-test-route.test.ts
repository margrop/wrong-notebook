/**
 * /api/ai/test 权限测试：测试会让服务端请求调用方给出的地址，只允许管理员
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    analyzeImage: vi.fn(),
    withAccessToken: vi.fn(),
    userFindUnique: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.userFindUnique } } }));
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), box: vi.fn(), divider: vi.fn() })),
}));
vi.mock('@/lib/minimax-code/auth', () => ({ withAccessToken: mocks.withAccessToken }));
vi.mock('@/lib/ai/anthropic-provider', () => ({
    DEFAULT_ANTHROPIC_MODEL: 'claude-sonnet-5-5',
    AnthropicProvider: class {
        analyzeImage = mocks.analyzeImage;
    },
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/ai/test/route';

function makeRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/ai/test', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('POST /api/ai/test', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('普通用户返回 403，且不调用 AI', async () => {
        mocks.getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'u@localhost', role: 'user' }, expires: '2099-01-01' });
        mocks.userFindUnique.mockResolvedValue({ id: 'u1', role: 'user' });

        const response = await POST(makeRequest({ provider: 'anthropic', apiKey: 'k', baseUrl: 'http://10.0.0.1' }));

        expect(response.status).toBe(403);
        expect(mocks.analyzeImage).not.toHaveBeenCalled();
    });

    it('管理员可以测试 Anthropic 提供商', async () => {
        mocks.getServerSession.mockResolvedValue({ user: { id: 'a1', email: 'admin@localhost', role: 'admin' }, expires: '2099-01-01' });
        mocks.userFindUnique.mockResolvedValue({ id: 'a1', role: 'admin' });
        mocks.analyzeImage.mockResolvedValue({ questionText: '2 + 3 = ?', analysis: '加法' });

        const response = await POST(makeRequest({ provider: 'anthropic', apiKey: 'k' }));
        const data = await response.json();

        expect(data).toMatchObject({ success: true, visionSupport: true, modelInfo: 'claude-sonnet-5-5' });
    });

    it('MiniMax Code 不需要 apiKey，使用已登录的凭据', async () => {
        mocks.getServerSession.mockResolvedValue({ user: { id: 'a1', email: 'admin@localhost', role: 'admin' }, expires: '2099-01-01' });
        mocks.userFindUnique.mockResolvedValue({ id: 'a1', role: 'admin' });
        mocks.withAccessToken.mockImplementation((fn: (token: string) => Promise<unknown>) => fn('mmoat_x'));
        mocks.analyzeImage.mockResolvedValue({ questionText: '2 + 3 = ?', analysis: '加法' });

        const response = await POST(makeRequest({ provider: 'minimax-code' }));
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toMatchObject({ success: true, visionSupport: true, modelInfo: 'MiniMax-M3.1-Flash' });
    });

    it('MiniMax Code 未登录时返回 AI_AUTH_ERROR', async () => {
        mocks.getServerSession.mockResolvedValue({ user: { id: 'a1', email: 'admin@localhost', role: 'admin' }, expires: '2099-01-01' });
        mocks.userFindUnique.mockResolvedValue({ id: 'a1', role: 'admin' });
        mocks.withAccessToken.mockRejectedValue(new Error('AI_AUTH_ERROR: MiniMax Code is not logged in'));

        const data = await (await POST(makeRequest({ provider: 'minimax-code' }))).json();

        expect(data).toMatchObject({ success: false, visionError: 'AI_AUTH_ERROR', textError: 'AI_AUTH_ERROR' });
        expect(mocks.analyzeImage).not.toHaveBeenCalled();
    });
});
