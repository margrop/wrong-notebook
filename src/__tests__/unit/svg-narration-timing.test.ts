/**
 * svg-narration 纯函数模块：分段时间计算与语速切换
 */
import { describe, expect, it } from 'vitest';

import {
    AUDIO_START_TIMEOUT_MS,
    HOLD_LEAD_S,
    LOADING_HOLD_DELAY_MS,
    maxSpeakingMs,
    NARRATION_RATES,
    nextRate,
    segmentIndexAt,
    START_TIMEOUT_MS,
} from '@/lib/svg-narration/timing';

describe('segmentIndexAt', () => {
    it('返回时间所在的段（最后一个 begin ≤ time 的段）', () => {
        const segments = [
            { begin: 0, text: 'a' },
            { begin: 5, text: 'b' },
            { begin: 10, text: 'c' },
        ];
        expect(segmentIndexAt(segments, 0)).toBe(0);
        expect(segmentIndexAt(segments, 4.9)).toBe(0);
        expect(segmentIndexAt(segments, 5)).toBe(1);
        expect(segmentIndexAt(segments, 10)).toBe(2);
        expect(segmentIndexAt(segments, 99)).toBe(2);
    });

    it('第一段之前返回 -1', () => {
        expect(segmentIndexAt([{ begin: 1, text: 'a' }], 0)).toBe(-1);
        expect(segmentIndexAt([], 0)).toBe(-1);
    });

    it('允许 0.05 秒的提前量', () => {
        const segments = [{ begin: 5, text: 'a' }];
        expect(segmentIndexAt(segments, 4.96)).toBe(0);
        expect(segmentIndexAt(segments, 4.94)).toBe(-1);
    });
});

describe('maxSpeakingMs', () => {
    it('按文字长度和语速估计，且不低于 8 秒', () => {
        expect(maxSpeakingMs('短', 1)).toBe(8000);
        expect(maxSpeakingMs('一二三四五六七八九十', 1)).toBe(9000);
        expect(maxSpeakingMs('一二三四五六七八九十', 2)).toBe(8000);
    });

    it('语速越快时长越短', () => {
        const text = '一二三四五六七八九十'.repeat(10);
        expect(maxSpeakingMs(text, 2)).toBeLessThan(maxSpeakingMs(text, 1));
    });
});

describe('nextRate', () => {
    it('按 NARRATION_RATES 顺序循环', () => {
        expect(nextRate(1)).toBe(1.25);
        expect(nextRate(1.25)).toBe(1.5);
        expect(nextRate(1.5)).toBe(0.75);
        expect(nextRate(0.75)).toBe(1);
    });

    it('不在列表中的值回退到第一个', () => {
        expect(nextRate(2)).toBe(1);
        expect(nextRate(NaN)).toBe(1);
    });
});

describe('常量', () => {
    it('超时与提前量的取值', () => {
        expect(START_TIMEOUT_MS).toBe(2500);
        expect(AUDIO_START_TIMEOUT_MS).toBe(8000);
        expect(LOADING_HOLD_DELAY_MS).toBe(300);
        expect(HOLD_LEAD_S).toBe(0.8);
    });

    it('NARRATION_RATES 包含四种语速', () => {
        expect(NARRATION_RATES).toEqual([1, 1.25, 1.5, 0.75]);
    });
});
