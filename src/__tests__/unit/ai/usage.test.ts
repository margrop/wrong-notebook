/**
 * AI 补全用量记录：写入字段、长度截断、失败不影响业务
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    create: vi.fn(),
    error: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: { aiCompletion: { create: mocks.create } } }));
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.error })),
}));

import { recordAiCompletion } from '@/lib/ai/usage';

describe('recordAiCompletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.create.mockResolvedValue({});
    });

    it('按用户、操作和渠道写入一次补全的用量', async () => {
        await recordAiCompletion({ userId: 'u1', kind: 'analyze' }, 'deepseek', {
            task: 'analyze',
            status: 'succeeded',
            durationMs: 1234.6,
            usage: { inputTokens: 1000, outputTokens: 200 },
            model: 'deepseek-chat',
            requestId: 'req-1',
        });

        expect(mocks.create).toHaveBeenCalledWith({
            data: {
                userId: 'u1',
                kind: 'analyze',
                task: 'analyze',
                provider: 'deepseek',
                model: 'deepseek-chat',
                inputTokens: 1000,
                outputTokens: 200,
                requestId: 'req-1',
                durationMs: 1235,
                status: 'succeeded',
                errorCode: null,
            },
        });
    });

    it('失败的补全记录错误码，缺失的用量记为空', async () => {
        await recordAiCompletion({ userId: 'u1', kind: 'mastery' }, 'openai', {
            task: 'mastery',
            status: 'failed',
            durationMs: 50,
            model: 'gpt-4o',
            errorCode: 'AI_TIMEOUT_ERROR',
        });

        expect(mocks.create.mock.calls[0][0].data).toMatchObject({
            kind: 'mastery',
            status: 'failed',
            errorCode: 'AI_TIMEOUT_ERROR',
            inputTokens: null,
            outputTokens: null,
            requestId: null,
        });
    });

    it('过长的模型名和请求 ID 截断到 200 字符', async () => {
        await recordAiCompletion({ userId: 'u1', kind: 'grade' }, 'openai', {
            task: 'grading', status: 'succeeded', durationMs: 1, model: 'm'.repeat(300), requestId: 'r'.repeat(300),
        });

        const data = mocks.create.mock.calls[0][0].data;
        expect(data.model).toHaveLength(200);
        expect(data.requestId).toHaveLength(200);
    });

    it('写入失败只记日志，不抛错', async () => {
        mocks.create.mockRejectedValue(new Error('database is locked'));

        await expect(recordAiCompletion({ userId: 'u1', kind: 'grade' }, 'openai', {
            task: 'grading', status: 'succeeded', durationMs: 1,
        })).resolves.toBeUndefined();
        expect(mocks.error).toHaveBeenCalled();
    });
});
