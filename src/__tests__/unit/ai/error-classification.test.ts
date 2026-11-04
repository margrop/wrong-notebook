import { describe, it, expect } from 'vitest';
import { parseErrorCode, isAIErrorCode } from '@/lib/ai/error-classification';

describe('parseErrorCode', () => {
    describe('标准错误码透传', () => {
        it.each([
            'AI_CONNECTION_FAILED',
            'AI_TIMEOUT_ERROR',
            'AI_QUOTA_EXCEEDED',
            'AI_PERMISSION_DENIED',
            'AI_NOT_FOUND',
            'AI_RESPONSE_ERROR',
            'AI_AUTH_ERROR',
            'AI_SERVICE_UNAVAILABLE',
            'AI_UNKNOWN_ERROR',
        ])('已含 %s 时原样返回', (code) => {
            expect(parseErrorCode(new Error(`something ${code} happened`))).toBe(code);
        });
    });

    describe('AI_AUTH_ERROR', () => {
        it('匹配 401', () => {
            expect(parseErrorCode(new Error('HTTP 401'))).toBe('AI_AUTH_ERROR');
        });
        it('匹配 unauthorized', () => {
            expect(parseErrorCode(new Error('Request unauthorized'))).toBe('AI_AUTH_ERROR');
        });
        it('匹配 api key', () => {
            expect(parseErrorCode(new Error('invalid api key'))).toBe('AI_AUTH_ERROR');
        });
    });

    describe('AI_PERMISSION_DENIED', () => {
        it('匹配 403', () => {
            expect(parseErrorCode(new Error('HTTP 403'))).toBe('AI_PERMISSION_DENIED');
        });
        it('匹配 forbidden', () => {
            expect(parseErrorCode(new Error('Access forbidden'))).toBe('AI_PERMISSION_DENIED');
        });
        it('匹配 permission', () => {
            expect(parseErrorCode(new Error('permission denied'))).toBe('AI_PERMISSION_DENIED');
        });
    });

    describe('AI_NOT_FOUND', () => {
        it('匹配 404', () => {
            expect(parseErrorCode(new Error('HTTP 404'))).toBe('AI_NOT_FOUND');
        });
        it('匹配 not found', () => {
            expect(parseErrorCode(new Error('model not found'))).toBe('AI_NOT_FOUND');
        });
        it('匹配 does not exist', () => {
            expect(parseErrorCode(new Error('model does not exist'))).toBe('AI_NOT_FOUND');
        });
    });

    describe('AI_QUOTA_EXCEEDED', () => {
        it('匹配 429', () => {
            expect(parseErrorCode(new Error('HTTP 429'))).toBe('AI_QUOTA_EXCEEDED');
        });
        it('匹配 rate limit', () => {
            expect(parseErrorCode(new Error('rate limit exceeded'))).toBe('AI_QUOTA_EXCEEDED');
        });
        it('匹配 too many', () => {
            expect(parseErrorCode(new Error('too many requests'))).toBe('AI_QUOTA_EXCEEDED');
        });
        it('匹配 quota', () => {
            expect(parseErrorCode(new Error('quota exceeded'))).toBe('AI_QUOTA_EXCEEDED');
        });
        it('匹配额度', () => {
            expect(parseErrorCode(new Error('额度已用完'))).toBe('AI_QUOTA_EXCEEDED');
        });
    });

    describe('AI_CONNECTION_FAILED', () => {
        it('匹配 fetch failed', () => {
            expect(parseErrorCode(new Error('fetch failed'))).toBe('AI_CONNECTION_FAILED');
        });
        it('匹配 network', () => {
            expect(parseErrorCode(new Error('network error'))).toBe('AI_CONNECTION_FAILED');
        });
        it('匹配 connect', () => {
            expect(parseErrorCode(new Error('connection refused'))).toBe('AI_CONNECTION_FAILED');
        });
        it('匹配 enotfound', () => {
            expect(parseErrorCode(new Error('ENOTFOUND api.example.com'))).toBe('AI_CONNECTION_FAILED');
        });
        it('匹配 econnrefused', () => {
            expect(parseErrorCode(new Error('ECONNREFUSED 127.0.0.1'))).toBe('AI_CONNECTION_FAILED');
        });
        it('匹配 etimedout', () => {
            expect(parseErrorCode(new Error('ETIMEDOUT'))).toBe('AI_CONNECTION_FAILED');
        });
        it('匹配 econnreset', () => {
            expect(parseErrorCode(new Error('ECONNRESET'))).toBe('AI_CONNECTION_FAILED');
        });
    });

    describe('AI_TIMEOUT_ERROR', () => {
        it('匹配 timeout', () => {
            expect(parseErrorCode(new Error('timeout'))).toBe('AI_TIMEOUT_ERROR');
        });
        it('匹配 timed out', () => {
            expect(parseErrorCode(new Error('request timed out'))).toBe('AI_TIMEOUT_ERROR');
        });
        it('匹配 aborted', () => {
            expect(parseErrorCode(new Error('request aborted'))).toBe('AI_TIMEOUT_ERROR');
        });
        it('匹配 408', () => {
            expect(parseErrorCode(new Error('HTTP 408'))).toBe('AI_TIMEOUT_ERROR');
        });
    });

    describe('AI_SERVICE_UNAVAILABLE', () => {
        it.each(['500', '502', '503', '504'])('匹配 HTTP %s', (code) => {
            expect(parseErrorCode(new Error(`HTTP ${code}`))).toBe('AI_SERVICE_UNAVAILABLE');
        });
        it('匹配 无可用', () => {
            expect(parseErrorCode(new Error('无可用模型'))).toBe('AI_SERVICE_UNAVAILABLE');
        });
        it('匹配 overloaded', () => {
            expect(parseErrorCode(new Error('server overloaded'))).toBe('AI_SERVICE_UNAVAILABLE');
        });
        it('匹配 unavailable', () => {
            expect(parseErrorCode(new Error('service unavailable'))).toBe('AI_SERVICE_UNAVAILABLE');
        });
    });

    describe('AI_RESPONSE_ERROR', () => {
        it('匹配 invalid json', () => {
            expect(parseErrorCode(new Error('invalid json response'))).toBe('AI_RESPONSE_ERROR');
        });
        it('匹配 parse', () => {
            expect(parseErrorCode(new Error('failed to parse'))).toBe('AI_RESPONSE_ERROR');
        });
        it('匹配 json', () => {
            expect(parseErrorCode(new Error('Unexpected token in JSON'))).toBe('AI_RESPONSE_ERROR');
        });
        it('匹配 missing critical xml', () => {
            expect(parseErrorCode(new Error('missing critical xml tag'))).toBe('AI_RESPONSE_ERROR');
        });
    });

    describe('AI_UNKNOWN_ERROR', () => {
        it('无法归类时返回 AI_UNKNOWN_ERROR', () => {
            expect(parseErrorCode(new Error('something completely unexpected'))).toBe('AI_UNKNOWN_ERROR');
        });
    });

    describe('非 Error 对象', () => {
        it('接受字符串', () => {
            expect(parseErrorCode('fetch failed')).toBe('AI_CONNECTION_FAILED');
        });
        it('接受 null', () => {
            expect(parseErrorCode(null)).toBe('AI_UNKNOWN_ERROR');
        });
        it('接受 undefined', () => {
            expect(parseErrorCode(undefined)).toBe('AI_UNKNOWN_ERROR');
        });
    });
});

describe('isAIErrorCode', () => {
    it('识别标准错误码', () => {
        expect(isAIErrorCode('error AI_TIMEOUT_ERROR occurred')).toBe(true);
    });
    it('拒绝普通消息', () => {
        expect(isAIErrorCode('just a normal error')).toBe(false);
    });
});
