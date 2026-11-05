/**
 * getAIService(scope)：每次补全的用量按调用方传入的用户和操作记录，渠道取当前配置
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    create: vi.fn(),
    getAppConfig: vi.fn(),
    recordAiCompletion: vi.fn(),
}));

vi.mock('openai', async () => {
    const { sdkMethod } = await import('../../helpers/sdk-response');
    return { default: class MockOpenAI { chat = { completions: { create: sdkMethod(mocks.create) } }; } };
});
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), box: vi.fn(), divider: vi.fn() })),
}));
vi.mock('@/lib/config', () => ({ getAppConfig: mocks.getAppConfig, getActiveOpenAIConfig: vi.fn() }));
vi.mock('@/lib/ai/usage', () => ({ recordAiCompletion: mocks.recordAiCompletion }));

import { getAIService } from '@/lib/ai';
import { withHeaders } from '../../helpers/sdk-response';

describe('getAIService(scope)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAppConfig.mockReturnValue({ aiProvider: 'deepseek', deepseek: { apiKey: 'k' }, prompts: {} });
    });

    it('补全结束后按 scope 和配置的渠道记录用量', async () => {
        mocks.create.mockResolvedValue(withHeaders({
            model: 'deepseek-chat',
            usage: { prompt_tokens: 80, completion_tokens: 20 },
            choices: [{ finish_reason: 'stop', message: { content: '{"correct":true,"reason":"一致"}' } }],
        }, { 'x-oneapi-request-id': 'gw-9' }));

        const ai = await getAIService({ userId: 'u1', kind: 'grade' });
        await ai.gradeAnswer({ questionText: '1+1', answerText: '2', userAnswer: '2' });

        expect(mocks.recordAiCompletion).toHaveBeenCalledWith(
            { userId: 'u1', kind: 'grade' },
            'deepseek',
            expect.objectContaining({ task: 'grading', status: 'succeeded', usage: { inputTokens: 80, outputTokens: 20 }, requestId: 'gw-9' }),
        );
    });

    it('不同 scope 取得的服务各自记录，互不串用', async () => {
        mocks.create.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{"correct":true,"reason":"一致"}' } }] });

        const first = await getAIService({ userId: 'u1', kind: 'grade' });
        const second = await getAIService({ userId: 'u2', kind: 'practice' });
        await second.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'a' });
        await first.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'a' });

        expect(mocks.recordAiCompletion.mock.calls.map((call) => call[0])).toEqual([
            { userId: 'u2', kind: 'practice' },
            { userId: 'u1', kind: 'grade' },
        ]);
    });

    it('补全失败时同样记录，业务方法照常抛错', async () => {
        mocks.create.mockRejectedValue(new Error('fetch failed'));

        const ai = await getAIService({ userId: 'u1', kind: 'grade' });
        await expect(ai.gradeAnswer({ questionText: 'q', answerText: 'a', userAnswer: 'a' })).rejects.toThrow();

        expect(mocks.recordAiCompletion).toHaveBeenCalledWith(
            { userId: 'u1', kind: 'grade' },
            'deepseek',
            expect.objectContaining({ status: 'failed', errorCode: 'AI_CONNECTION_FAILED' }),
        );
    });
});
