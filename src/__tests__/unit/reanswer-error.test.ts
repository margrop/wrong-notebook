import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { getReanswerErrorMessage } from '@/lib/question/reanswer-error';
import { translations } from '@/lib/translations';

const t = translations.zh;
const apiError = (message: string) => new ApiError(500, 'Error', { message });

describe('重新解题失败提示', () => {
    it.each([
        ['AI_AUTH_ERROR: invalid key', t.errors.reanswer.authError],
        ['AI_CONNECTION_FAILED', t.errors.reanswer.connectionFailed],
        ['AI_RESPONSE_ERROR', t.errors.reanswer.responseError],
    ])('%s 显示对应提示', (code, expected) => {
        expect(getReanswerErrorMessage(apiError(code), t)).toBe(expected);
    });

    it('其他错误显示默认提示', () => {
        expect(getReanswerErrorMessage(new Error('boom'), t)).toBe(t.errors.reanswer.default);
        expect(getReanswerErrorMessage(apiError('AI_TIMEOUT_ERROR'), t)).toBe(t.errors.reanswer.default);
    });
});
