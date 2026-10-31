/**
 * AI 并发上限解析单元测试
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_CONCURRENCY_LIMIT, isValidConcurrencyLimit, parseConcurrencyLimit } from '@/lib/ai-concurrency-limit';

describe('parseConcurrencyLimit', () => {
    it.each([
        ['3', 3],
        [10, 10],
        [100, 100],
        ['0', DEFAULT_AI_CONCURRENCY_LIMIT],
        [101, DEFAULT_AI_CONCURRENCY_LIMIT],
        ['2.5', DEFAULT_AI_CONCURRENCY_LIMIT],
        ['abc', DEFAULT_AI_CONCURRENCY_LIMIT],
        ['', DEFAULT_AI_CONCURRENCY_LIMIT],
        [undefined, DEFAULT_AI_CONCURRENCY_LIMIT],
    ])('%s → %s', (value, expected) => {
        expect(parseConcurrencyLimit(value)).toBe(expected);
    });

    it('只接受 1～100 的整数', () => {
        expect(isValidConcurrencyLimit(1)).toBe(true);
        expect(isValidConcurrencyLimit(0)).toBe(false);
        expect(isValidConcurrencyLimit('5')).toBe(false);
    });
});
