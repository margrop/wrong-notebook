/**
 * 补全结果工具函数：请求 ID 响应头、token 数校验、失败错误码
 */
import { describe, expect, it } from 'vitest';
import { compactUsage, completionErrorCode, readRequestId, tokenCount } from '@/lib/ai/completion';
import { AI_OUTPUT_TRUNCATED } from '@/lib/ai/truncation';

describe('readRequestId', () => {
    it('Headers 对象按优先级取值，不区分大小写', () => {
        expect(readRequestId(new Headers({ 'X-Request-Id': 'up', 'X-Oneapi-Request-Id': 'gw' }))).toBe('gw');
        expect(readRequestId(new Headers({ 'apim-request-id': 'azure-1' }))).toBe('azure-1');
    });

    it('普通对象的响应头同样不区分大小写，数组取第一个', () => {
        expect(readRequestId({ 'Request-Id': 'req_1' })).toBe('req_1');
        expect(readRequestId({ 'x-request-id': ['a', 'b'] })).toBe('a');
    });

    it('没有请求 ID 或只有空白时返回 undefined', () => {
        expect(readRequestId(undefined)).toBeUndefined();
        expect(readRequestId(new Headers({ 'content-type': 'application/json' }))).toBeUndefined();
        expect(readRequestId({ 'x-request-id': '  ' })).toBeUndefined();
    });
});

describe('token 用量', () => {
    it('只接受非负有限数', () => {
        expect(tokenCount(12)).toBe(12);
        expect(tokenCount(-1)).toBeUndefined();
        expect(tokenCount(Number.NaN)).toBeUndefined();
        expect(tokenCount('12')).toBeUndefined();
    });

    it('输入输出都缺失时不返回用量', () => {
        expect(compactUsage(undefined, null)).toBeUndefined();
        expect(compactUsage(5, undefined)).toEqual({ inputTokens: 5, outputTokens: undefined });
    });
});

describe('completionErrorCode', () => {
    it('截断保留原错误码，其余按标准错误码归类', () => {
        expect(completionErrorCode(new Error(AI_OUTPUT_TRUNCATED))).toBe(AI_OUTPUT_TRUNCATED);
        expect(completionErrorCode(new Error('fetch failed'))).toBe('AI_CONNECTION_FAILED');
    });
});
