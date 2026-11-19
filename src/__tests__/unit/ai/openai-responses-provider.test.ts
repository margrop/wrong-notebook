// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as listModels } from '@/app/api/ai/models/route';
import { POST as testConnection } from '@/app/api/ai/test/route';
import { getAIService } from '@/lib/ai';
import { resetLearnedOutputLimits } from '@/lib/ai/truncation';

const mocks = vi.hoisted(() => ({
    getAppConfig: vi.fn(),
    getServerSession: vi.fn(),
    userFindUnique: vi.fn(),
    record: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn<typeof fetch>(),
}));

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/config', () => ({ getAppConfig: mocks.getAppConfig }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.userFindUnique } } }));
vi.mock('@/lib/ai/account-provider', () => ({
    getAiAccountProvider: () => ({ resolveConfig: async () => undefined, record: mocks.record }),
}));
vi.mock('@/lib/logger', () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), box: vi.fn(), divider: vi.fn() }),
}));

const scope = { userId: 'student-1', kind: 'retag' } as const;
const tagResult = '{"tags":["加法"],"difficultyStars":1}';
const questionResult = '<question_text>2+3=?</question_text><answer_text>5</answer_text><analysis>加法</analysis>';
const custom = { provider: 'openai-responses', apiKey: 'test-key', baseUrl: 'https://gateway.example.com/custom/v1/', model: 'custom-model' };

function post(route: string, body: unknown) {
    return new NextRequest(`http://localhost/api/ai/${route}`, {
        method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
    });
}

function providerResponse(texts: string[], override: Record<string, unknown> = {}) {
    return Response.json({
        object: 'response', status: 'completed', model: 'served-model',
        usage: { input_tokens: 17, output_tokens: 43 },
        output: [
            { type: 'reasoning', summary: [{ type: 'summary_text', text: '思考过程不应计入正文' }] },
            { type: 'message', role: 'assistant', content: texts.map((text) => ({ type: 'output_text', text })) },
        ],
        ...override,
    }, { headers: { 'x-oneapi-request-id': 'gateway-request-1' } });
}

function requestAt(index: number) {
    return new Request(...mocks.fetch.mock.calls[index]);
}

describe('OpenAI Responses API', () => {
    beforeEach(() => {
        resetLearnedOutputLimits();
        mocks.fetch.mockReset();
        vi.stubGlobal('fetch', mocks.fetch);
        mocks.getAppConfig.mockReturnValue({ aiProvider: 'openai-responses', 'openai-responses': { apiKey: 'test-key' } });
        mocks.getServerSession.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@localhost', role: 'admin' } });
        mocks.userFindUnique.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('走官方 Responses 端点，合并文本块并记录实际模型、用量和请求 ID', async () => {
        mocks.fetch.mockResolvedValueOnce(providerResponse([tagResult.slice(0, 15), tagResult.slice(15)]));

        const service = await getAIService(scope);
        const result = await service.suggestKnowledgeTags({ questionText: '1+1=?', subject: '数学', allowedTags: ['加法'] });

        const request = requestAt(0);
        expect(request.url).toBe('https://api.openai.com/v1/responses');
        expect(request.headers.get('Authorization')).toBe('Bearer test-key');
        expect(await request.json()).toMatchObject({
            model: 'gpt-6.1-sol', instructions: expect.any(String), store: false, max_output_tokens: 128000,
            input: [{ role: 'user', content: [{ type: 'input_text', text: expect.stringContaining('1+1=?') }] }],
        });
        expect(result.tags).toEqual(['加法']);
        expect(mocks.record).toHaveBeenCalledWith(scope, 'openai-responses', expect.objectContaining({
            status: 'succeeded', model: 'served-model', requestId: 'gateway-request-1', usage: { inputTokens: 17, outputTokens: 43 },
        }));
    });

    it('连接测试向自定义地址发送 Responses 图片请求，模型列表使用同一基础地址', async () => {
        mocks.fetch.mockResolvedValueOnce(providerResponse([questionResult]));
        mocks.fetch.mockResolvedValueOnce(Response.json({ data: [{ id: custom.model }] }));

        const tested = await testConnection(post('test', custom));
        const listed = await listModels(post('models', custom));
        expect(tested.ok).toBe(true);

        const request = requestAt(0);
        expect(request.url).toBe('https://gateway.example.com/custom/v1/responses');
        expect(await request.json()).toMatchObject({ model: custom.model, input: [{ role: 'user', content: [
            { type: 'input_text', text: expect.any(String) },
            { type: 'input_image', image_url: expect.stringMatching(/^data:image\/jpeg;base64,/) },
        ] }] });
        expect(await tested.json()).toMatchObject({ success: true, visionSupport: true, modelInfo: custom.model });
        expect(requestAt(1).url).toBe('https://gateway.example.com/custom/v1/models');
        expect(await listed.json()).toMatchObject({ models: [{ id: custom.model }] });
    });

    it('图片能力不支持时仍可测试文字模型', async () => {
        mocks.fetch.mockResolvedValueOnce(Response.json({ error: { message: 'This model does not support image input' } }, { status: 400 }));
        mocks.fetch.mockResolvedValueOnce(providerResponse([questionResult]));

        const response = await testConnection(post('test', custom));
        expect(await response.json()).toMatchObject({ success: true, textSupport: true, visionSupport: false, visionError: 'VISION_NOT_SUPPORTED' });
        expect(await requestAt(1).json()).toMatchObject({ input: [{ role: 'user', content: [{ type: 'input_text' }] }] });
    });

    it('模型拒绝输出上限时降低 max_output_tokens 重试，并区分无正文的截断', async () => {
        mocks.fetch.mockResolvedValueOnce(Response.json({
            error: { message: 'max_output_tokens must be <= 8192' },
        }, { status: 400 }));
        mocks.fetch.mockResolvedValueOnce(providerResponse([], {
            status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
        }));

        const service = await getAIService(scope);
        await expect(service.suggestKnowledgeTags({ questionText: '1+1=?', subject: '数学', allowedTags: ['加法'] }))
            .rejects.toThrow('AI_OUTPUT_TRUNCATED');
        expect(await requestAt(1).json()).toMatchObject({ max_output_tokens: 8192 });
    });

    it('HTTP 200 中的服务商额度错误不会当作连接成功', async () => {
        mocks.fetch.mockResolvedValueOnce(providerResponse([], {
            status: 'failed', error: { code: 'insufficient_quota', message: 'No quota remaining' },
        }));

        const response = await testConnection(post('test', custom));
        expect(await response.json()).toMatchObject({ success: false, textError: 'AI_QUOTA_EXCEEDED', visionError: 'AI_QUOTA_EXCEEDED' });
        expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });
});
