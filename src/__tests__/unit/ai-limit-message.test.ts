/**
 * 拒绝 AI 调用的错误码：额度用完（每日上限、额度不足）与未授权
 */
import { describe, expect, it } from 'vitest';
import { AI_LIMIT_MESSAGES, isAiLimitCode, isAiRejectionCode } from '@/lib/ai-limit-message';
import { ErrorCode } from '@/lib/error-codes';

describe('AI 拒绝错误码', () => {
    it('额度用完包含每日上限和额度不足，未授权不算额度用完', () => {
        expect(isAiLimitCode('AI_DAILY_LIMIT_EXCEEDED')).toBe(true);
        expect(isAiLimitCode('AI_QUOTA_INSUFFICIENT')).toBe(true);
        expect(isAiLimitCode('AI_CONSENT_REQUIRED')).toBe(false);
        expect(isAiLimitCode(undefined)).toBe(false);
    });

    it('调用前拒绝的错误码包含额度用完和未授权，不含调用中的服务商错误', () => {
        expect(isAiRejectionCode('AI_QUOTA_INSUFFICIENT')).toBe(true);
        expect(isAiRejectionCode('AI_CONSENT_REQUIRED')).toBe(true);
        expect(isAiRejectionCode('AI_QUOTA_EXCEEDED')).toBe(false);
        expect(isAiRejectionCode(42)).toBe(false);
    });

    it('每个额度错误码都有统一错误码和中英文提示', () => {
        for (const [code, messages] of Object.entries(AI_LIMIT_MESSAGES)) {
            expect(ErrorCode[code as keyof typeof ErrorCode]).toBe(code);
            expect(messages.zh).toBeTruthy();
            expect(messages.en).toBeTruthy();
        }
    });
});
