import { describe, it, expect } from 'vitest';
import { formatExamScore, normalizeExamScore, summarizeExamScores } from '@/lib/exam/exam-score';

describe('normalizeExamScore', () => {
    it('接受合法分值并保留一位小数', () => {
        expect(normalizeExamScore(2)).toBe(2);
        expect(normalizeExamScore(2.5)).toBe(2.5);
        expect(normalizeExamScore(0.5)).toBe(0.5);
        expect(normalizeExamScore(1000)).toBe(1000);
        expect(normalizeExamScore(3.1)).toBe(3.1);
    });

    it('null 表示清空分值', () => {
        expect(normalizeExamScore(null)).toBeNull();
    });

    it('拒绝越界、多位小数与非法类型', () => {
        expect(normalizeExamScore(0)).toBeNull();
        expect(normalizeExamScore(-1)).toBeNull();
        expect(normalizeExamScore(1000.1)).toBeNull();
        expect(normalizeExamScore(2.55)).toBeNull();
        expect(normalizeExamScore(0.15)).toBeNull();
        expect(normalizeExamScore(Number.NaN)).toBeNull();
        expect(normalizeExamScore(Number.POSITIVE_INFINITY)).toBeNull();
        expect(normalizeExamScore('2.5')).toBeNull();
        expect(normalizeExamScore(undefined)).toBeNull();
    });
});

describe('summarizeExamScores', () => {
    it('只累加已设分值的题目并统计未设分值的题数', () => {
        expect(summarizeExamScores([2, 2.5, null])).toEqual({ scored: 2, unscored: 1, total: 4.5 });
        expect(summarizeExamScores([null, undefined, null])).toEqual({ scored: 0, unscored: 3, total: null });
        expect(summarizeExamScores([])).toEqual({ scored: 0, unscored: 0, total: null });
        expect(summarizeExamScores([0.1, 0.2])).toEqual({ scored: 2, unscored: 0, total: 0.3 });
    });
});

describe('formatExamScore', () => {
    it('整数不带小数点，一位小数保留', () => {
        expect(formatExamScore(2)).toBe('2');
        expect(formatExamScore(2.5)).toBe('2.5');
        expect(formatExamScore(1000)).toBe('1000');
    });
});
