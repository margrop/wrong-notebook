import { formatDateTime, getDayRange, getMonthStart } from "@/lib/date-time";
import type { StatsRange } from "@/lib/stats/stats-range-core";

export type { StatsRange } from "@/lib/stats/stats-range-core";
export { parseStatsRange } from "@/lib/stats/stats-range-core";

export type StatsGranularity = 'day' | 'month';

/** 趋势分桶：每桶覆盖 [start, end) 时间段 */
export interface StatsBucket {
    /** 桶的显示标签 */
    label: string;
    /** 桶起始时间（含） */
    start: Date;
    /** 桶结束时间（不含） */
    end: Date;
}

/** 解析后的时间范围信息 */
export interface StatsRangeInfo {
    range: StatsRange;
    /** 筛选起始时间，'all' 时为 null */
    start: Date | null;
    /** 趋势粒度 */
    granularity: StatsGranularity;
    /** 趋势分桶列表 */
    buckets: StatsBucket[];
}

/**
 * 根据范围计算起始时间。
 * 7d：6 天前的零点；30d：29 天前的零点；6m：5 个月前的月初；all：null。
 */
export function getRangeStart(range: StatsRange, now: Date, timeZone: string): Date | null {
    switch (range) {
        case '7d':
            return getDayRange(now, timeZone, -6).start;
        case '30d':
            return getDayRange(now, timeZone, -29).start;
        case '6m':
            return getMonthStart(now, timeZone, -5);
        case 'all':
            return null;
    }
}

/** 7d/30d 按天分桶，6m/all 按月分桶 */
export function getStatsGranularity(range: StatsRange): StatsGranularity {
    return range === '7d' || range === '30d' ? 'day' : 'month';
}

/**
 * 生成趋势分桶列表。
 * - day 粒度：从起始日期到当天（含），每桶一天
 * - month 粒度：从起始月份到当前月（含），每桶一个月
 * - 'all'：从最早数据所在月到当前月；无数据时只有当前月
 */
export function buildStatsBuckets(
    range: StatsRange,
    start: Date | null,
    earliest: Date | null,
    now: Date,
    timeZone: string,
): StatsBucket[] {
    const granularity = getStatsGranularity(range);
    const buckets: StatsBucket[] = [];

    if (granularity === 'day') {
        // 起始日（应用时区的零点）
        const startDay = start ?? getDayRange(now, timeZone, -6).start;
        // 计算起始日与当前日之间的天数差
        const startDayZoned = new Date(startDay);
        const todayStart = getDayRange(now, timeZone, 0).start;
        const diffMs = todayStart.getTime() - startDayZoned.getTime();
        const dayCount = Math.round(diffMs / 86400000) + 1;

        for (let i = 0; i < dayCount; i++) {
            const { start: bucketStart, end: bucketEnd } = getDayRange(now, timeZone, i - (dayCount - 1));
            buckets.push({
                label: formatDateTime(bucketStart, 'MM-dd', timeZone),
                start: bucketStart,
                end: bucketEnd,
            });
        }
    } else {
        // month 粒度
        let monthStart: Date;
        if (range === 'all') {
            if (earliest) {
                monthStart = getMonthStart(earliest, timeZone, 0);
            } else {
                monthStart = getMonthStart(now, timeZone, 0);
            }
        } else {
            // 6m
            monthStart = start ?? getMonthStart(now, timeZone, -5);
        }

        // 计算从 monthStart 到当前月的月数差
        const currentMonthStart = getMonthStart(now, timeZone, 0);
        const startYear = Number(formatDateTime(monthStart, 'yyyy', timeZone));
        const startMonth = Number(formatDateTime(monthStart, 'MM', timeZone));
        const endYear = Number(formatDateTime(currentMonthStart, 'yyyy', timeZone));
        const endMonth = Number(formatDateTime(currentMonthStart, 'MM', timeZone));
        const monthCount = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;

        // 从最早月份开始逐月推进
        let offset = -(monthCount - 1);
        for (let i = 0; i < monthCount; i++) {
            const bucketStart = getMonthStart(now, timeZone, offset);
            const bucketEnd = getMonthStart(now, timeZone, offset + 1);
            buckets.push({
                label: formatDateTime(bucketStart, 'yyyy-MM', timeZone),
                start: bucketStart,
                end: bucketEnd,
            });
            offset++;
        }
    }

    return buckets;
}

/**
 * 汇总时间范围的完整信息。
 * @param range 时间范围
 * @param earliest 该用户最早一条数据的时间（用于 all 的分桶起点），可为 null
 * @param now 当前时间
 * @param timeZone 应用时区
 */
export function resolveStatsRange(
    range: StatsRange,
    earliest: Date | null,
    now: Date,
    timeZone: string,
): StatsRangeInfo {
    const start = getRangeStart(range, now, timeZone);
    const granularity = getStatsGranularity(range);
    const buckets = buildStatsBuckets(range, start, earliest, now, timeZone);
    return { range, start, granularity, buckets };
}

/**
 * 把记录时间归入对应桶的索引；不在任何桶内返回 -1。
 */
export function findBucketIndex(buckets: StatsBucket[], date: Date): number {
    for (let i = buckets.length - 1; i >= 0; i--) {
        if (date >= buckets[i].start && date < buckets[i].end) {
            return i;
        }
    }
    return -1;
}
