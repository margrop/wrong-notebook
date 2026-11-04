import { describe, expect, it } from 'vitest';
import { computeCurrentStreak, computeLongestStreak, computeStreaks } from '@/lib/stats/stats-streak';

describe('computeCurrentStreak', () => {
    it('无数据时返回 0', () => {
        expect(computeCurrentStreak(new Set(), '2026-11-03')).toBe(0);
    });

    it('今天有活动时从今天往前算', () => {
        const active = new Set(['2026-11-01', '2026-11-02', '2026-11-03']);
        expect(computeCurrentStreak(active, '2026-11-03')).toBe(3);
    });

    it('今天无活动但昨天有时从昨天往前算', () => {
        const active = new Set(['2026-11-01', '2026-11-02']);
        expect(computeCurrentStreak(active, '2026-11-03')).toBe(2);
    });

    it('今天和昨天都无活动时返回 0', () => {
        const active = new Set(['2026-10-30', '2026-10-31']);
        expect(computeCurrentStreak(active, '2026-11-03')).toBe(0);
    });

    it('跨月连续', () => {
        const active = new Set(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
        expect(computeCurrentStreak(active, '2026-11-02')).toBe(4);
    });

    it('跨年连续', () => {
        const active = new Set(['2025-12-30', '2025-12-31', '2026-01-01']);
        expect(computeCurrentStreak(active, '2026-01-01')).toBe(3);
    });

    it('中断后只算最近一段', () => {
        const active = new Set(['2026-10-28', '2026-10-29', '2026-10-30', '2026-11-01', '2026-11-02']);
        expect(computeCurrentStreak(active, '2026-11-02')).toBe(2);
    });
});

describe('computeLongestStreak', () => {
    it('无数据时返回 0', () => {
        expect(computeLongestStreak(new Set())).toBe(0);
    });

    it('单天返回 1', () => {
        expect(computeLongestStreak(new Set(['2026-11-03']))).toBe(1);
    });

    it('连续多段取最长', () => {
        const active = new Set(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
        expect(computeLongestStreak(active)).toBe(5);
    });

    it('跨月最长连续', () => {
        const active = new Set(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-05']);
        expect(computeLongestStreak(active)).toBe(4);
    });

    it('跨年最长连续', () => {
        const active = new Set(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-10']);
        expect(computeLongestStreak(active)).toBe(4);
    });

    it('全部中断时最长为 1', () => {
        const active = new Set(['2026-10-01', '2026-10-03', '2026-10-05']);
        expect(computeLongestStreak(active)).toBe(1);
    });
});

describe('computeStreaks', () => {
    it('返回完整结果', () => {
        const active = new Set(['2026-11-01', '2026-11-02', '2026-11-03', '2026-10-15']);
        const result = computeStreaks(active, '2026-11-03');
        expect(result.currentStreak).toBe(3);
        expect(result.longestStreak).toBe(3);
        expect(result.totalActiveDays).toBe(4);
    });

    it('无数据时全部返回 0', () => {
        const result = computeStreaks(new Set(), '2026-11-03');
        expect(result.currentStreak).toBe(0);
        expect(result.longestStreak).toBe(0);
        expect(result.totalActiveDays).toBe(0);
    });
});
