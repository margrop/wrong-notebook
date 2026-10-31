/**
 * 推理模型输出截断重试单元测试
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { AI_OUTPUT_TRUNCATED, TRUNCATION_RETRY_MAX_TOKENS, UNKNOWN_MODEL_RETRY_MAX_TOKENS, getModelMaxOutputTokens, isTruncatedWithoutContent, resetLearnedOutputLimits, withTruncationRetry } from '@/lib/ai/truncation';

const truncated = { choices: [{ finish_reason: 'length', message: { content: '' } }] };
const answered = { choices: [{ finish_reason: 'stop', message: { content: '答案' } }] };

describe('withTruncationRetry', () => {
    beforeEach(() => resetLearnedOutputLimits());

    it('正常返回时只调用一次', async () => {
        const call = vi.fn().mockResolvedValue(answered);
        expect(await withTruncationRetry(call, 8192)).toBe(answered);
        expect(call).toHaveBeenCalledTimes(1);
        expect(call).toHaveBeenCalledWith(8192);
    });

    it('思考耗尽额度时用更大的上限重试一次', async () => {
        const call = vi.fn().mockResolvedValueOnce(truncated).mockResolvedValueOnce(answered);
        const onRetry = vi.fn();

        expect(await withTruncationRetry(call, 8192, onRetry)).toBe(answered);
        expect(call.mock.calls.map((args) => args[0])).toEqual([8192, UNKNOWN_MODEL_RETRY_MAX_TOKENS]);
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('重试后仍被截断时报 AI_OUTPUT_TRUNCATED', async () => {
        const call = vi.fn().mockResolvedValue(truncated);
        await expect(withTruncationRetry(call, 8192)).rejects.toThrow(AI_OUTPUT_TRUNCATED);
        expect(call).toHaveBeenCalledTimes(2);
    });

    it('正文写到一半被截断时也用更大的上限重试', async () => {
        const partial = { choices: [{ finish_reason: 'length', message: { content: '<question_text>半截' } }] };
        const call = vi.fn().mockResolvedValueOnce(partial).mockResolvedValueOnce(answered);

        expect(await withTruncationRetry(call, 8192)).toBe(answered);
        expect(call.mock.calls.map((args) => args[0])).toEqual([8192, UNKNOWN_MODEL_RETRY_MAX_TOKENS]);
    });

    it('重试后仍只有部分正文时返回该结果，由调用方尽力解析', async () => {
        const partial = { choices: [{ finish_reason: 'length', message: { content: '部分' } }] };
        const call = vi.fn().mockResolvedValue(partial);

        expect(await withTruncationRetry(call, 8192)).toBe(partial);
        expect(call).toHaveBeenCalledTimes(2);
    });

    it('已知模型截断后按模型的最大输出重试', async () => {
        const call = vi.fn().mockResolvedValueOnce(truncated).mockResolvedValueOnce(answered);

        expect(await withTruncationRetry(call, 8192, undefined, 'claude-sonnet-4-5')).toBe(answered);
        expect(call.mock.calls.map((args) => args[0])).toEqual([8192, 64000]);
    });

    it('首次请求不超过模型上限，已用满上限时不再重试', async () => {
        const call = vi.fn().mockResolvedValue(truncated);

        await expect(withTruncationRetry(call, 16384, undefined, 'gpt-4-turbo')).rejects.toThrow(AI_OUTPUT_TRUNCATED);
        expect(call.mock.calls.map((args) => args[0])).toEqual([4096]);
    });

    it('未知模型的重试上限超限时读出错误中的上限再试并记住', async () => {
        const call = vi.fn()
            .mockResolvedValueOnce(truncated)
            .mockRejectedValueOnce(new Error('400 Invalid max_tokens value, the valid range of max_tokens is [1, 16384]'))
            .mockResolvedValueOnce(answered);

        expect(await withTruncationRetry(call, 8192, undefined, 'Some-New-Model')).toBe(answered);
        expect(call.mock.calls.map((args) => args[0])).toEqual([8192, UNKNOWN_MODEL_RETRY_MAX_TOKENS, 16384]);
        expect(getModelMaxOutputTokens('some-new-model')).toBe(16384);

        const next = vi.fn().mockResolvedValueOnce(truncated).mockResolvedValueOnce(answered);
        await withTruncationRetry(next, 8192, undefined, 'Some-New-Model');
        expect(next.mock.calls.map((args) => args[0])).toEqual([8192, 16384]);
    });

    it('上限超限但读不出数字时退回保底上限', async () => {
        const call = vi.fn()
            .mockResolvedValueOnce(truncated)
            .mockRejectedValueOnce(new Error('400 max_tokens is invalid'))
            .mockResolvedValueOnce(answered);

        expect(await withTruncationRetry(call, 8192, undefined, 'unknown-model')).toBe(answered);
        expect(call.mock.calls.map((args) => args[0])).toEqual([8192, UNKNOWN_MODEL_RETRY_MAX_TOKENS, TRUNCATION_RETRY_MAX_TOKENS]);
    });

    it('与输出上限无关的错误直接抛出', async () => {
        const call = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
        await expect(withTruncationRetry(call, 8192, undefined, 'unknown-model')).rejects.toThrow('401');
        expect(call).toHaveBeenCalledTimes(1);
    });

    it('有部分正文的截断不视为空结果', () => {
        expect(isTruncatedWithoutContent({ choices: [{ finish_reason: 'length', message: { content: '部分内容' } }] })).toBe(false);
        expect(isTruncatedWithoutContent(truncated)).toBe(true);
    });
});
