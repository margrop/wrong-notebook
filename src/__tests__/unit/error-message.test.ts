import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { getApiErrorDetails, getApiErrorMessage, getErrorDetail, getErrorMessage } from '@/lib/error-message';

describe('错误信息提取', () => {
    it('Error 取 message，其他值转为字符串', () => {
        expect(getErrorMessage(new Error('boom'))).toBe('boom');
        expect(getErrorMessage('plain')).toBe('plain');
        expect(getErrorMessage(404)).toBe('404');
    });

    it('取 ApiError 中后端返回的 message', () => {
        expect(getApiErrorMessage(new ApiError(400, 'Bad Request', { message: 'AI_TIMEOUT_ERROR' }))).toBe('AI_TIMEOUT_ERROR');
    });

    it.each([
        ['普通 Error', new Error('boom')],
        ['响应体为文本', new ApiError(500, 'Server Error', 'oops')],
        ['message 不是字符串', new ApiError(500, 'Server Error', { message: 1 })],
        ['null', null],
    ])('%s 时返回 undefined', (_name, error) => {
        expect(getApiErrorMessage(error)).toBeUndefined();
    });
});

describe('服务商原始报错', () => {
    it('沿 cause 取最内层、不是错误码的消息', () => {
        const original = new Error('429 已达到 Token Plan 用量上限');
        expect(getErrorDetail(new Error('AI_QUOTA_EXCEEDED', { cause: original }))).toBe('429 已达到 Token Plan 用量上限');
        expect(getErrorDetail(new Error('MiniMax 2056: 用量上限'))).toBe('MiniMax 2056: 用量上限');
        expect(getErrorDetail(new Error('AI_UNKNOWN_ERROR', { cause: 'socket hang up' }))).toBe('socket hang up');
    });

    it('只有错误码或没有消息时返回 undefined；过长时截断并合并空白', () => {
        expect(getErrorDetail(new Error('AI_TIMEOUT_ERROR'))).toBeUndefined();
        expect(getErrorDetail(null)).toBeUndefined();
        expect(getErrorDetail(new Error('a\n\n  b'))).toBe('a b');
        const long = getErrorDetail(new Error('x'.repeat(800)));
        expect(long).toHaveLength(501);
        expect(long?.endsWith('…')).toBe(true);
    });

    it('取 ApiError 中的 details 文本', () => {
        expect(getApiErrorDetails(new ApiError(502, 'Bad Gateway', { message: 'TTS_PROVIDER_ERROR', details: 'MiniMax 2056' }))).toBe('MiniMax 2056');
        expect(getApiErrorDetails(new ApiError(502, 'Bad Gateway', { message: 'TTS_PROVIDER_ERROR' }))).toBeUndefined();
        expect(getApiErrorDetails(new ApiError(502, 'Bad Gateway', { details: { a: 1 } }))).toBeUndefined();
        expect(getApiErrorDetails(new Error('x'))).toBeUndefined();
    });
});
