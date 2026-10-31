import { afterEach, describe, expect, it } from 'vitest';
import {
    DEBUG_MODE_DURATION_MS,
    MAX_DEBUG_ENTRIES,
    MAX_STRING_LENGTH,
    clearDebugLogs,
    getDebugLogEntries,
    getDebugLogStatus,
    isDebugModeEnabled,
    recordDebugLog,
    sanitizeForDebug,
    setDebugMode,
} from '@/lib/debug-log';
import { createLogger } from '@/lib/logger';

afterEach(() => {
    setDebugMode(false);
    clearDebugLogs();
});

describe('调试日志', () => {
    it('调试模式关闭时不记录', () => {
        recordDebugLog('info', {}, 'ignored');
        expect(getDebugLogEntries()).toHaveLength(0);
    });

    it('开启后记录所有级别，开启时清空上一轮日志，关闭后保留日志', () => {
        setDebugMode(true);
        recordDebugLog('debug', { module: 'x' }, 'first');
        expect(getDebugLogEntries()).toHaveLength(1);

        setDebugMode(true);
        recordDebugLog('trace', {}, 'second');
        expect(getDebugLogEntries().map((e) => e.msg)).toEqual(['second']);

        setDebugMode(false);
        recordDebugLog('info', {}, 'after off');
        expect(getDebugLogStatus()).toMatchObject({ enabled: false, entryCount: 1 });
    });

    it('超过时限后自动关闭', () => {
        const start = Date.UTC(2026, 0, 1);
        setDebugMode(true, start);
        expect(isDebugModeEnabled(start + DEBUG_MODE_DURATION_MS - 1)).toBe(true);
        expect(isDebugModeEnabled(start + DEBUG_MODE_DURATION_MS)).toBe(false);
    });

    it('超过条数上限时丢弃最早的记录', () => {
        setDebugMode(true);
        for (let i = 0; i < MAX_DEBUG_ENTRIES + 3; i++) recordDebugLog('info', {}, `m${i}`);
        const entries = getDebugLogEntries();
        expect(entries).toHaveLength(MAX_DEBUG_ENTRIES);
        expect(entries[0].msg).toBe('m3');
        expect(getDebugLogStatus().droppedCount).toBe(3);
    });

    it('logger 在调试模式下记录低于 LOG_LEVEL 的日志', () => {
        setDebugMode(true);
        createLogger('debug-test').trace({ step: 1 }, 'trace message');
        expect(getDebugLogEntries()).toEqual([
            expect.objectContaining({ level: 'trace', module: 'debug-test', step: 1, msg: 'trace message' }),
        ]);
    });
});

describe('调试日志脱敏', () => {
    it('去掉密钥类字段，保留 token 用量等普通字段', () => {
        const result = sanitizeForDebug({
            apiKey: 'AIza-secret',
            nested: { password: 'p', accessToken: 't', Authorization: 'Bearer x', maxTokens: 100, totalTokens: 5 },
            emptyKey: { apiKey: '' },
        });
        expect(result).toEqual({
            apiKey: '[REDACTED]',
            nested: { password: '[REDACTED]', accessToken: '[REDACTED]', Authorization: '[REDACTED]', maxTokens: 100, totalTokens: 5 },
            emptyKey: { apiKey: '' },
        });
    });

    it('字符串中的 Bearer 令牌、sk- Key、URL key 参数和图片 data URL 被替换', () => {
        const text = sanitizeForDebug('Bearer abc.def sk-1234567890abcdef https://x/v1?key=AIzaSecret&a=1 data:image/png;base64,AAAABBBB') as string;
        expect(text).not.toMatch(/abc\.def|1234567890abcdef|AIzaSecret|AAAABBBB/);
        expect(text).toContain('[data:image/png,');
        expect(text).toContain('&a=1');
    });

    it('超长字符串截断，循环引用和 Error 可序列化', () => {
        const circular: Record<string, unknown> = { name: 'a' };
        circular.self = circular;
        const result = sanitizeForDebug({
            long: 'x'.repeat(MAX_STRING_LENGTH + 10),
            circular,
            error: new TypeError('boom'),
        }) as Record<string, Record<string, unknown> | string>;
        expect((result.long as string).length).toBeLessThan(MAX_STRING_LENGTH + 50);
        expect((result.circular as Record<string, unknown>).self).toBe('[Circular]');
        expect(result.error).toMatchObject({ name: 'TypeError', message: 'boom' });
        expect(() => JSON.stringify(result)).not.toThrow();
    });
});
