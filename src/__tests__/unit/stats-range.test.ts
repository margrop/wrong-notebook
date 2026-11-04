import { describe, it, expect } from 'vitest';
import {
    parseStatsRange,
    getRangeStart,
    getStatsGranularity,
    buildStatsBuckets,
    resolveStatsRange,
    findBucketIndex,
} from '@/lib/stats/stats-range';

const TZ = 'Asia/Shanghai';

describe('parseStatsRange', () => {
    it('合法值原样返回', () => {
        expect(parseStatsRange('7d')).toBe('7d');
        expect(parseStatsRange('30d')).toBe('30d');
        expect(parseStatsRange('6m')).toBe('6m');
        expect(parseStatsRange('all')).toBe('all');
    });

    it('非法值回落默认 30d', () => {
        expect(parseStatsRange('invalid')).toBe('30d');
        expect(parseStatsRange('')).toBe('30d');
        expect(parseStatsRange(null)).toBe('30d');
        expect(parseStatsRange(undefined)).toBe('30d');
        expect(parseStatsRange('7D')).toBe('30d');
        expect(parseStatsRange('1y')).toBe('30d');
    });
});

describe('getRangeStart', () => {
    const now = new Date('2026-10-18T12:00:00Z'); // 北京时间 2026-10-18 20:00

    it('7d 返回 6 天前的零点（北京时间）', () => {
        const start = getRangeStart('7d', now, TZ);
        // 北京时间 2026-10-12 00:00 = UTC 2026-10-11T16:00:00Z
        expect(start?.toISOString()).toBe('2026-10-11T16:00:00.000Z');
    });

    it('30d 返回 29 天前的零点（北京时间）', () => {
        const start = getRangeStart('30d', now, TZ);
        // 北京时间 2026-09-19 00:00 = UTC 2026-09-18T16:00:00Z
        expect(start?.toISOString()).toBe('2026-09-18T16:00:00.000Z');
    });

    it('6m 返回 5 个月前的月初（北京时间）', () => {
        const start = getRangeStart('6m', now, TZ);
        // 北京时间 2026-05-01 00:00 = UTC 2026-04-30T16:00:00Z
        expect(start?.toISOString()).toBe('2026-04-30T16:00:00.000Z');
    });

    it('all 返回 null', () => {
        expect(getRangeStart('all', now, TZ)).toBeNull();
    });

    it('跨年时 6m 正确计算', () => {
        const janNow = new Date('2026-01-15T12:00:00Z'); // 北京时间 2026-01-15 20:00
        const start = getRangeStart('6m', janNow, TZ);
        // 北京时间 2025-08-01 00:00 = UTC 2025-07-31T16:00:00Z
        expect(start?.toISOString()).toBe('2025-07-31T16:00:00.000Z');
    });
});

describe('getStatsGranularity', () => {
    it('7d/30d 为 day 粒度', () => {
        expect(getStatsGranularity('7d')).toBe('day');
        expect(getStatsGranularity('30d')).toBe('day');
    });

    it('6m/all 为 month 粒度', () => {
        expect(getStatsGranularity('6m')).toBe('month');
        expect(getStatsGranularity('all')).toBe('month');
    });
});

describe('buildStatsBuckets', () => {
    const now = new Date('2026-10-18T12:00:00Z'); // 北京时间 2026-10-18 20:00

    it('7d 生成 7 个每日分桶，标签为 MM-dd', () => {
        const start = getRangeStart('7d', now, TZ)!;
        const buckets = buildStatsBuckets('7d', start, null, now, TZ);
        expect(buckets).toHaveLength(7);
        expect(buckets[0].label).toBe('10-12');
        expect(buckets[6].label).toBe('10-18');
        // 每桶是北京时间的一天
        expect(buckets[0].start.toISOString()).toBe('2026-10-11T16:00:00.000Z');
        expect(buckets[0].end.toISOString()).toBe('2026-10-12T16:00:00.000Z');
        expect(buckets[6].end.toISOString()).toBe('2026-10-18T16:00:00.000Z');
    });

    it('30d 生成 30 个每日分桶', () => {
        const start = getRangeStart('30d', now, TZ)!;
        const buckets = buildStatsBuckets('30d', start, null, now, TZ);
        expect(buckets).toHaveLength(30);
        expect(buckets[0].label).toBe('09-19');
        expect(buckets[29].label).toBe('10-18');
    });

    it('6m 生成 6 个月度分桶，标签为 yyyy-MM', () => {
        const start = getRangeStart('6m', now, TZ)!;
        const buckets = buildStatsBuckets('6m', start, null, now, TZ);
        expect(buckets).toHaveLength(6);
        expect(buckets[0].label).toBe('2026-05');
        expect(buckets[5].label).toBe('2026-10');
        // 跨月边界正确
        expect(buckets[0].start.toISOString()).toBe('2026-04-30T16:00:00.000Z');
        expect(buckets[0].end.toISOString()).toBe('2026-05-31T16:00:00.000Z');
    });

    it('6m 跨年时正确生成月度分桶', () => {
        const janNow = new Date('2026-01-15T12:00:00Z');
        const start = getRangeStart('6m', janNow, TZ)!;
        const buckets = buildStatsBuckets('6m', start, null, janNow, TZ);
        expect(buckets).toHaveLength(6);
        expect(buckets[0].label).toBe('2025-08');
        expect(buckets[5].label).toBe('2026-01');
    });

    it('all 有数据时从最早数据所在月开始分桶', () => {
        const earliest = new Date('2025-03-15T08:00:00Z'); // 北京时间 2025-03-15 16:00
        const buckets = buildStatsBuckets('all', null, earliest, now, TZ);
        // 从 2025-03 到 2026-10 共 20 个月
        expect(buckets).toHaveLength(20);
        expect(buckets[0].label).toBe('2025-03');
        expect(buckets[19].label).toBe('2026-10');
    });

    it('all 无数据时只有当前月', () => {
        const buckets = buildStatsBuckets('all', null, null, now, TZ);
        expect(buckets).toHaveLength(1);
        expect(buckets[0].label).toBe('2026-10');
    });

    it('all 最早数据在本月时只有当前月', () => {
        const earliest = new Date('2026-10-01T02:00:00Z');
        const buckets = buildStatsBuckets('all', null, earliest, now, TZ);
        expect(buckets).toHaveLength(1);
        expect(buckets[0].label).toBe('2026-10');
    });

    it('跨时区（纽约）分桶按纽约时间计算', () => {
        const nyNow = new Date('2026-10-18T12:00:00Z'); // 纽约时间 2026-10-18 08:00 (EDT, UTC-4)
        const start = getRangeStart('7d', nyNow, 'America/New_York')!;
        const buckets = buildStatsBuckets('7d', start, null, nyNow, 'America/New_York');
        expect(buckets).toHaveLength(7);
        expect(buckets[0].label).toBe('10-12');
        expect(buckets[6].label).toBe('10-18');
        // 纽约时间 2026-10-12 00:00 EDT = UTC 2026-10-12T04:00:00Z
        expect(buckets[0].start.toISOString()).toBe('2026-10-12T04:00:00.000Z');
    });

    it('月末日期不会漏桶', () => {
        // 北京时间 2026-10-31 20:00
        const endOfMonth = new Date('2026-10-31T12:00:00Z');
        const start = getRangeStart('7d', endOfMonth, TZ)!;
        const buckets = buildStatsBuckets('7d', start, null, endOfMonth, TZ);
        expect(buckets).toHaveLength(7);
        expect(buckets[6].label).toBe('10-31');
        expect(buckets[6].end.toISOString()).toBe('2026-10-31T16:00:00.000Z');
    });
});

describe('resolveStatsRange', () => {
    const now = new Date('2026-10-18T12:00:00Z');

    it('返回完整的范围信息', () => {
        const info = resolveStatsRange('30d', null, now, TZ);
        expect(info.range).toBe('30d');
        expect(info.start?.toISOString()).toBe('2026-09-18T16:00:00.000Z');
        expect(info.granularity).toBe('day');
        expect(info.buckets).toHaveLength(30);
    });

    it('all 返回 null start 和 month granularity', () => {
        const info = resolveStatsRange('all', new Date('2025-06-15T00:00:00Z'), now, TZ);
        expect(info.range).toBe('all');
        expect(info.start).toBeNull();
        expect(info.granularity).toBe('month');
        expect(info.buckets[0].label).toBe('2025-06');
        expect(info.buckets.at(-1)!.label).toBe('2026-10');
    });
});

describe('findBucketIndex', () => {
    const now = new Date('2026-10-18T12:00:00Z');

    it('返回记录所属的桶索引', () => {
        const start = getRangeStart('7d', now, TZ)!;
        const buckets = buildStatsBuckets('7d', start, null, now, TZ);
        // 北京时间 2026-10-15 12:00 = UTC 2026-10-15T04:00:00Z
        const record = new Date('2026-10-15T04:00:00Z');
        const idx = findBucketIndex(buckets, record);
        expect(idx).toBe(3); // 第 4 桶（10-15）
        expect(buckets[idx].label).toBe('10-15');
    });

    it('返回 -1 当记录不在任何桶内', () => {
        const start = getRangeStart('7d', now, TZ)!;
        const buckets = buildStatsBuckets('7d', start, null, now, TZ);
        // 北京时间 2026-10-19 00:30 = UTC 2026-10-18T16:30:00Z（桶结束之后）
        const record = new Date('2026-10-18T16:30:00Z');
        expect(findBucketIndex(buckets, record)).toBe(-1);
        // 北京时间 2026-10-11 23:30 = UTC 2026-10-11T15:30:00Z（桶开始之前）
        const before = new Date('2026-10-11T15:30:00Z');
        expect(findBucketIndex(buckets, before)).toBe(-1);
    });

    it('月度桶正确归属跨月记录', () => {
        const start = getRangeStart('6m', now, TZ)!;
        const buckets = buildStatsBuckets('6m', start, null, now, TZ);
        // 北京时间 2026-05-31 23:00 = UTC 2026-05-31T15:00:00Z，应归入 2026-05
        const record = new Date('2026-05-31T15:00:00Z');
        const idx = findBucketIndex(buckets, record);
        expect(buckets[idx].label).toBe('2026-05');
        // 北京时间 2026-06-01 01:00 = UTC 2026-05-31T17:00:00Z，应归入 2026-06
        const record2 = new Date('2026-05-31T17:00:00Z');
        const idx2 = findBucketIndex(buckets, record2);
        expect(buckets[idx2].label).toBe('2026-06');
    });
});
