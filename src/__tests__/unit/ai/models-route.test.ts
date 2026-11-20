/**
 * Models Route 单元测试
 *
 * 测试 /api/ai/models 端点的权限控制及 Gemini、OpenAI、Anthropic 模型列表功能
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock logger
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        box: vi.fn(),
        divider: vi.fn(),
    })),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockPrismaUserFindUnique = vi.hoisted(() => vi.fn());
vi.mock('next-auth', () => ({ getServerSession: mockGetServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mockPrismaUserFindUnique } } }));

import { POST } from '@/app/api/ai/models/route';

const adminSession = { user: { id: 'admin-1', email: 'admin@localhost', role: 'admin' }, expires: '2099-01-01' };

function makeRequest(params: Record<string, string>): NextRequest {
    return new NextRequest('http://localhost/api/ai/models', {
        method: 'POST',
        body: JSON.stringify(params),
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('POST /api/ai/models - 权限', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPrismaUserFindUnique.mockResolvedValue({ id: 'admin-1', email: 'admin@localhost', role: 'admin', isActive: true });
    });

    it('未登录时返回 401，且不请求外部地址', async () => {
        mockGetServerSession.mockResolvedValue(null);

        const res = await POST(makeRequest({ provider: 'openai', apiKey: 'k', baseUrl: 'http://10.0.0.1' }));

        expect(res.status).toBe(401);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('普通用户返回 403，且不请求外部地址', async () => {
        mockGetServerSession.mockResolvedValue({ user: { id: 'u1', email: 'u@localhost', role: 'user' }, expires: '2099-01-01' });
        mockPrismaUserFindUnique.mockResolvedValue({ id: 'u1', email: 'u@localhost', role: 'user', isActive: true });

        const res = await POST(makeRequest({ provider: 'openai', apiKey: 'k', baseUrl: 'http://10.0.0.1' }));

        expect(res.status).toBe(403);
        expect(mockFetch).not.toHaveBeenCalled();
    });
});

describe('POST /api/ai/models - 地址校验', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(adminSession);
        mockPrismaUserFindUnique.mockResolvedValue({ id: 'admin-1', email: 'admin@localhost', role: 'admin', isActive: true });
    });

    it.each(['file:///etc/passwd', 'ftp://example.com', 'not a url'])('拒绝非 http/https 地址 %s，且不发起请求', async (baseUrl) => {
        const res = await POST(makeRequest({ provider: 'openai', apiKey: 'k', baseUrl }));
        const body = await res.json();

        expect(mockFetch).not.toHaveBeenCalled();
        expect(body.models).toEqual([]);
        expect(body.error).toMatch(/base URL/i);
    });

    it('Gemini 的 API Key 在查询参数中编码', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) });

        await POST(makeRequest({ provider: 'gemini', apiKey: 'a&b=c' }));

        expect(mockFetch.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=a%26b%3Dc');
    });
});

describe('POST /api/ai/models - Anthropic provider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(adminSession);
        mockPrismaUserFindUnique.mockResolvedValue({ id: 'admin-1', email: 'admin@localhost', role: 'admin', isActive: true });
    });

    it('用 x-api-key 请求 /v1/models 并返回模型列表', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }] }),
        });

        const res = await POST(makeRequest({ provider: 'anthropic', apiKey: 'sk-ant-test', baseUrl: 'https://gateway.example.com/anthropic/' }));
        const body = await res.json();

        expect(mockFetch).toHaveBeenCalledWith(
            'https://gateway.example.com/anthropic/v1/models?limit=100',
            expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'sk-ant-test' }) })
        );
        expect(body.models).toEqual([{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', owned_by: 'Anthropic' }]);
    });

    it('未填 baseUrl 时使用官方地址', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });

        await POST(makeRequest({ provider: 'anthropic', apiKey: 'sk-ant-test' }));

        expect(mockFetch.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/models?limit=100');
    });
});

describe('POST /api/ai/models - Gemini provider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(adminSession);
        mockPrismaUserFindUnique.mockResolvedValue({ id: 'admin-1', email: 'admin@localhost', role: 'admin', isActive: true });
    });

    it('应该正确获取并返回 Gemini 视觉模型列表', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                models: [
                    { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
                    { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
                    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
                ],
            }),
        });

        const req = makeRequest({ provider: 'gemini', apiKey: 'test-key' });
        const res = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.models).toHaveLength(3);
        expect(body.models[0]).toEqual({
            id: 'gemini-2.0-flash',
            name: 'gemini-2.0-flash',
            owned_by: 'Google',
        });
        expect(body.models[1].id).toBe('gemini-1.5-pro');
        expect(body.models[2].id).toBe('gemini-2.5-flash');
    });

    it('应该使用自定义 baseUrl', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ models: [] }),
        });

        const req = makeRequest({
            provider: 'gemini',
            apiKey: 'my-key',
            baseUrl: 'https://custom.google.com',
        });
        await POST(req);

        expect(mockFetch).toHaveBeenCalledWith(
            'https://custom.google.com/v1beta/models?key=my-key',
            expect.any(Object)
        );
    });

    it('应返回所有模型（不区分视觉/非视觉）', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                models: [
                    { name: 'models/gemini-2.0-flash' },
                    { name: 'models/text-embedding-004' },
                    { name: 'models/gemini-1.5-pro' },
                    { name: 'models/text-to-speech-01' },
                ],
            }),
        });

        const req = makeRequest({ provider: 'gemini', apiKey: 'test-key' });
        const res = await POST(req);
        const body = await res.json();

        expect(body.models).toHaveLength(4);
        expect(body.models.map((m: { id: string }) => m.id)).toEqual([
            'gemini-2.0-flash',
            'text-embedding-004',
            'gemini-1.5-pro',
            'text-to-speech-01',
        ]);
    });

    it('API 返回空 models 数组时应返回空列表', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ models: [] }),
        });

        const req = makeRequest({ provider: 'gemini', apiKey: 'test-key' });
        const res = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.models).toEqual([]);
    });

    it('API 返回无 models 字段时应返回空列表', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({}),
        });

        const req = makeRequest({ provider: 'gemini', apiKey: 'test-key' });
        const res = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.models).toEqual([]);
    });

    it('Gemini API 返回错误时应返回 200 和空模型列表', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 403,
            text: async () => 'Forbidden',
        });

        const req = makeRequest({ provider: 'gemini', apiKey: 'bad-key' });
        const res = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.models).toEqual([]);
        expect(body.error).toContain('Gemini API error');
    });

    it('缺少 apiKey 时应返回 400', async () => {
        const req = makeRequest({ provider: 'gemini' });
        const res = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.error).toBe('API key is required');
    });
});

describe('POST /api/ai/models - OpenAI provider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(adminSession);
        mockPrismaUserFindUnique.mockResolvedValue({ id: 'admin-1', email: 'admin@localhost', role: 'admin', isActive: true });
    });

    it('应该正确获取并返回 OpenAI 视觉模型列表', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                data: [
                    { id: 'gpt-4o', owned_by: 'openai' },
                    { id: 'gpt-4-turbo', owned_by: 'openai' },
                    { id: 'text-embedding-3-small', owned_by: 'openai' },
                ],
            }),
        });

        const req = makeRequest({ apiKey: 'test-key' });
        const res = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.models).toHaveLength(3);
        expect(body.models[0].id).toBe('gpt-4o');
        expect(body.models[1].id).toBe('gpt-4-turbo');
        expect(body.models[2].id).toBe('text-embedding-3-small');
    });

    it('OpenAI API 返回错误时应返回 200 和空模型列表', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            statusText: 'Unauthorized',
            status: 401,
        });

        const req = makeRequest({ apiKey: 'bad-key' });
        const res = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.models).toEqual([]);
        expect(body.error).toContain('API error');
    });
});
