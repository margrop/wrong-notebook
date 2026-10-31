/**
 * 模型最大输出 token 表与错误信息解析单元测试
 */
import { describe, it, expect } from 'vitest';
import { getKnownModelMaxOutputTokens, isMaxTokensError, parseMaxOutputTokensFromError } from '@/lib/ai/model-output-limits';

describe('getKnownModelMaxOutputTokens', () => {
    it.each([
        ['claude-opus-5-5', 128000],
        ['claude-sonnet-4-6', 128000],
        ['claude-haiku-4.5', 64000],
        ['claude-sonnet-4-5-20250929', 64000],
        ['claude-sonnet-4-20250514', 64000],
        ['claude-opus-4-1', 32000],
        ['claude-3-7-sonnet-latest', 64000],
        ['claude-3-5-sonnet-20241022', 8192],
        ['anthropic/claude-sonnet-4.5', 64000],
        ['gpt-5.1', 128000],
        ['o4-mini', 100000],
        ['gpt-4.1-mini', 32768],
        ['gpt-4o', 16384],
        ['gpt-4-turbo', 4096],
        ['gemini-2.5-flash', 65536],
        ['gemini-2.0-flash', 8192],
        ['gpt-6.1-sol', 128000],
        ['gpt-5.5', 128000],
        ['gemini-3.8-flash', 65536],
        ['gemini-4-argon', 65536],
        ['deepseek-v4-flash', 384000],
        ['deepseek-flash', 384000],
        ['glm-5.3-flash', 128000],
        ['GLM-4.6V', 32000],
        ['glm-4.5-air', 96000],
        ['doubao-seed-evolving', 256000],
        ['doubao-seed-2-0-lite-260428', 128000],
        ['MiniMax-M3.1-Flash', 128000],
        ['kimi-k3.1-pro', 131072],
        ['qwen3.8-max', 128000],
    ])('%s → %i', (model, expected) => {
        expect(getKnownModelMaxOutputTokens(model)).toBe(expected);
    });

    it('未知模型返回 undefined', () => {
        expect(getKnownModelMaxOutputTokens('step-5-preview')).toBeUndefined();
        expect(getKnownModelMaxOutputTokens('')).toBeUndefined();
        expect(getKnownModelMaxOutputTokens(undefined)).toBeUndefined();
    });
});

describe('parseMaxOutputTokensFromError', () => {
    it('解析 OpenAI 格式', () => {
        expect(parseMaxOutputTokensFromError('max_tokens is too large: 65536. This model supports at most 16384 completion tokens, whereas you provided 65536.', 65536)).toBe(16384);
    });

    it('解析 Anthropic 格式', () => {
        expect(parseMaxOutputTokensFromError('max_tokens: 65536 > 32000, which is the maximum allowed number of output tokens for claude-opus-4-1', 65536)).toBe(32000);
    });

    it('解析区间格式', () => {
        expect(parseMaxOutputTokensFromError('Range of max_tokens should be [1, 8192]', 65536)).toBe(8192);
    });

    it('与输出上限无关或读不出数字时返回 undefined', () => {
        expect(parseMaxOutputTokensFromError('Rate limit exceeded: 60000 tokens per minute', 65536)).toBeUndefined();
        expect(parseMaxOutputTokensFromError('max_tokens is invalid', 65536)).toBeUndefined();
    });

    it('识别输出上限相关的错误', () => {
        expect(isMaxTokensError('Invalid max_tokens')).toBe(true);
        expect(isMaxTokensError('Unauthorized')).toBe(false);
    });
});
