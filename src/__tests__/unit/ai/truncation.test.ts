/**
 * AI 调用输出上限单元测试：默认按模型的最大输出请求，接口拒绝时降到可用上限
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
    AI_OUTPUT_TRUNCATED, DEFAULT_MAX_OUTPUT_TOKENS, FALLBACK_MAX_OUTPUT_TOKENS, getModelMaxOutputTokens, isTruncatedWithoutContent, outputTokenLimit,
    resetLearnedOutputLimits, withModelOutputLimit,
} from '@/lib/ai/truncation';

const truncated = { choices: [{ finish_reason: 'length', message: { content: '' } }] };
const answered = { choices: [{ finish_reason: 'stop', message: { content: '答案' } }] };

describe('withModelOutputLimit', () => {
    beforeEach(() => resetLearnedOutputLimits());

    it('已知模型直接按官方最大输出请求，只调用一次', async () => {
        const call = vi.fn().mockResolvedValue(answered);
        expect(await withModelOutputLimit(call, 'MiniMax-M3.1-Flash')).toBe(answered);
        expect(call.mock.calls.map((args) => args[0])).toEqual([128000]);
        expect(outputTokenLimit('claude-sonnet-4-5')).toBe(64000);
        expect(outputTokenLimit('deepseek-v4-flash')).toBe(384000);
    });

    it('未知模型按默认上限（256K）请求，不再从小上限起步', async () => {
        expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(262144);
        const call = vi.fn().mockResolvedValue(answered);
        await withModelOutputLimit(call, 'qwen3-vl:8b-instruct');
        expect(call.mock.calls.map((args) => args[0])).toEqual([DEFAULT_MAX_OUTPUT_TOKENS]);
        await withModelOutputLimit(call);
        expect(call.mock.calls.at(-1)?.[0]).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });

    it('用满上限仍被截断且没有正文时报 AI_OUTPUT_TRUNCATED，不再重复请求', async () => {
        const call = vi.fn().mockResolvedValue(truncated);
        await expect(withModelOutputLimit(call, 'gpt-4o')).rejects.toThrow(AI_OUTPUT_TRUNCATED);
        expect(call.mock.calls.map((args) => args[0])).toEqual([16384]);
    });

    it('只有部分正文时返回该结果，由调用方尽力解析', async () => {
        const partial = { choices: [{ finish_reason: 'length', message: { content: '部分' } }] };
        const call = vi.fn().mockResolvedValue(partial);
        expect(await withModelOutputLimit(call, 'gpt-4o')).toBe(partial);
        expect(call).toHaveBeenCalledTimes(1);
    });

    it('网关返回空 choices 时原样返回，由调用方按空响应处理', async () => {
        const empty = { choices: null } as unknown as typeof answered;
        expect(await withModelOutputLimit(vi.fn().mockResolvedValue(empty), 'gpt-4o')).toBe(empty);
    });

    it('未知模型的上限超限时读出错误中的上限再试并记住', async () => {
        const call = vi.fn()
            .mockRejectedValueOnce(new Error('400 Invalid max_tokens value, the valid range of max_tokens is [1, 16384]'))
            .mockResolvedValueOnce(answered);

        expect(await withModelOutputLimit(call, 'Some-New-Model')).toBe(answered);
        expect(call.mock.calls.map((args) => args[0])).toEqual([DEFAULT_MAX_OUTPUT_TOKENS, 16384]);
        expect(getModelMaxOutputTokens('some-new-model')).toBe(16384);

        const next = vi.fn().mockResolvedValue(answered);
        await withModelOutputLimit(next, 'Some-New-Model');
        expect(next.mock.calls.map((args) => args[0])).toEqual([16384]);
    });

    it('上限超限但读不出数字时依次降到保底上限', async () => {
        const call = vi.fn()
            .mockRejectedValueOnce(new Error('400 max_tokens is invalid'))
            .mockRejectedValueOnce(new Error('400 max_tokens is invalid'))
            .mockRejectedValueOnce(new Error('400 max_tokens is invalid'))
            .mockResolvedValueOnce(answered);

        expect(await withModelOutputLimit(call, 'unknown-model')).toBe(answered);
        expect(call.mock.calls.map((args) => args[0])).toEqual([DEFAULT_MAX_OUTPUT_TOKENS, ...FALLBACK_MAX_OUTPUT_TOKENS]);
    });

    it('保底上限都被拒绝时抛出原错误', async () => {
        const call = vi.fn().mockRejectedValue(new Error('400 max_tokens is invalid'));
        await expect(withModelOutputLimit(call, 'unknown-model')).rejects.toThrow('max_tokens is invalid');
        expect(call).toHaveBeenCalledTimes(1 + FALLBACK_MAX_OUTPUT_TOKENS.length);
    });

    it('与输出上限无关的错误直接抛出', async () => {
        const call = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
        await expect(withModelOutputLimit(call, 'unknown-model')).rejects.toThrow('401');
        expect(call).toHaveBeenCalledTimes(1);
    });

    it('有部分正文的截断不视为空结果', () => {
        expect(isTruncatedWithoutContent({ choices: [{ finish_reason: 'length', message: { content: '部分内容' } }] })).toBe(false);
        expect(isTruncatedWithoutContent(truncated)).toBe(true);
    });
});
