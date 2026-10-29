/**
 * 国产大模型官方渠道测试：默认地址与模型、提供商选择、模型列表和连接测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    openaiOptions: [] as Array<{ apiKey?: string; baseURL?: string }>,
    create: vi.fn(),
    getAppConfig: vi.fn(),
    getServerSession: vi.fn(),
    fetch: vi.fn(),
}));

vi.mock('openai', () => ({
    default: class MockOpenAI {
        chat = { completions: { create: mocks.create } };
        constructor(options: { apiKey?: string; baseURL?: string }) {
            mocks.openaiOptions.push(options);
        }
    },
}));
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), box: vi.fn(), divider: vi.fn() })),
}));
vi.mock('@/lib/config', () => ({ getAppConfig: mocks.getAppConfig, getActiveOpenAIConfig: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.stubGlobal('fetch', mocks.fetch);

import { getAIService } from '@/lib/ai';
import { VENDOR_PRESETS, VENDOR_PROVIDER_IDS, isVendorProvider, resolveVendorConfig } from '@/lib/ai/vendor-presets';
import type { VendorProviderId } from '@/lib/ai/vendor-presets';
import { POST as listModels } from '@/app/api/ai/models/route';
import { POST as testConnection } from '@/app/api/ai/test/route';

// 各渠道的官方 OpenAI 兼容地址与默认模型
const EXPECTED: Record<VendorProviderId, { baseUrl: string; model: string }> = {
    minimax: { baseUrl: 'https://api.minimax.cn/v1', model: 'MiniMax-M3.1-Flash' },
    glm: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3-flash' },
    deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
    kimi: { baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3' },
    qwen: { baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-max' },
};

const adminSession = { user: { id: 'admin-1', role: 'admin' }, expires: '2099-01-01' };

function post(url: string, body: unknown): NextRequest {
    return new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}

describe('国产大模型渠道预设', () => {
    it('预设与期望的渠道一致', () => {
        expect([...VENDOR_PROVIDER_IDS].sort()).toEqual(Object.keys(EXPECTED).sort());
    });

    it('只识别已知渠道', () => {
        expect(isVendorProvider('openai')).toBe(false);
        expect(isVendorProvider('toString')).toBe(false);
        expect(isVendorProvider(undefined)).toBe(false);
    });
});

describe.each(VENDOR_PROVIDER_IDS)('%s 渠道', (id) => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.openaiOptions.length = 0;
        mocks.getServerSession.mockResolvedValue(adminSession);
    });

    it('默认使用官方地址与最新模型', () => {
        expect(VENDOR_PRESETS[id]).toMatchObject(EXPECTED[id]);
        expect(resolveVendorConfig(id, { apiKey: 'k' })).toEqual({ apiKey: 'k', ...EXPECTED[id] });
        expect(resolveVendorConfig(id, { apiKey: 'k', baseUrl: 'https://proxy.example.com/v1', model: 'custom' }))
            .toEqual({ apiKey: 'k', baseUrl: 'https://proxy.example.com/v1', model: 'custom' });
    });

    it('选中该渠道时通过 OpenAI 兼容接口调用官方地址和默认模型', async () => {
        mocks.getAppConfig.mockReturnValue({ aiProvider: id, [id]: { apiKey: 'vendor-key' } });
        mocks.create.mockResolvedValue({ choices: [{ message: { content: '{"tags": ["加法"], "difficultyStars": 1}' }, finish_reason: 'stop' }] });

        const service = getAIService();
        await service.suggestKnowledgeTags({ questionText: '1+1=?', subject: '数学', allowedTags: ['加法'] });

        expect(service.constructor.name).toBe('OpenAIProvider');
        expect(mocks.openaiOptions[0]).toMatchObject({ apiKey: 'vendor-key', baseURL: EXPECTED[id].baseUrl });
        expect(mocks.create.mock.calls[0][0].model).toBe(EXPECTED[id].model);
    });

    it('未填写 API Key 时报认证错误', () => {
        mocks.getAppConfig.mockReturnValue({ aiProvider: id, [id]: {} });
        expect(() => getAIService()).toThrow('AI_AUTH_ERROR');
    });

    it('模型列表默认请求官方地址', async () => {
        mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: EXPECTED[id].model, owned_by: id }] }) });

        const response = await listModels(post('http://localhost/api/ai/models', { provider: id, apiKey: 'k' }));
        const body = await response.json();

        expect(mocks.fetch.mock.calls[0][0]).toBe(`${EXPECTED[id].baseUrl}/models`);
        expect(body.models).toEqual([{ id: EXPECTED[id].model, name: EXPECTED[id].model, owned_by: id }]);
    });

    it('连接测试未填写模型时报告默认模型', async () => {
        mocks.create.mockResolvedValue({
            choices: [{ message: { content: '<question_text>2+3=?</question_text><answer_text>5</answer_text><analysis>加法</analysis>' }, finish_reason: 'stop' }],
        });

        const response = await testConnection(post('http://localhost/api/ai/test', { provider: id, apiKey: 'k' }));
        const data = await response.json();

        expect(data).toMatchObject({ success: true, visionSupport: true, modelInfo: EXPECTED[id].model });
        expect(mocks.openaiOptions[0]).toMatchObject({ baseURL: EXPECTED[id].baseUrl });
    });
});
