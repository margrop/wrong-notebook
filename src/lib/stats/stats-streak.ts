/**
 * 学习连续天数的纯函数计算。
 *
 * 输入为活跃日期集合（应用时区的 'yyyy-MM-dd' 字符串），
 * 输出当前连续天数、最长连续天数与累计活跃天数。
 */

export interface StreakResult {
    /** 截至 today 的连续活动天数；今天无活动但昨天有时从昨天往前算 */
    currentStreak: number;
    /** 全部历史中最长连续天数 */
    longestStreak: number;
    /** 全部历史活跃天数 */
    totalActiveDays: number;
}

/** 把 'yyyy-MM-dd' 解析为 UTC 毫秒时间戳（仅用于日期差计算，不受时区影响） */
function parseDayKey(dayKey: string): number {
    const [year, month, day] = dayKey.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
}

/** 毫秒转回 'yyyy-MM-dd'（UTC 基准，与 parseDayKey 对应） */
function formatDayKey(ms: number): string {
    const date = new Date(ms);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/** 计算当前连续天数：从 today 往前，遇到空缺即停；今天无活动则从昨天起算 */
export function computeCurrentStreak(activeDays: ReadonlySet<string>, today: string): number {
    let cursor = parseDayKey(today);
    // 今天无活动时，起点移到昨天
    if (!activeDays.has(today)) {
        cursor -= 86_400_000;
    }
    let streak = 0;
    while (activeDays.has(formatDayKey(cursor))) {
        streak++;
        cursor -= 86_400_000;
    }
    return streak;
}

/** 计算最长连续天数：把活跃日期排序后扫描相邻差值 */
export function computeLongestStreak(activeDays: ReadonlySet<string>): number {
    if (activeDays.size === 0) return 0;
    const sorted = [...activeDays].sort();
    let longest = 1;
    let current = 1;
    for (let i = 1; i < sorted.length; i++) {
        const diff = (parseDayKey(sorted[i]) - parseDayKey(sorted[i - 1])) / 86_400_000;
        if (diff === 1) {
            current++;
        } else {
            longest = Math.max(longest, current);
            current = 1;
        }
    }
    return Math.max(longest, current);
}

/** 汇总连续天数指标 */
export function computeStreaks(activeDays: ReadonlySet<string>, today: string): StreakResult {
    return {
        currentStreak: computeCurrentStreak(activeDays, today),
        longestStreak: computeLongestStreak(activeDays),
        totalActiveDays: activeDays.size,
    };
}
