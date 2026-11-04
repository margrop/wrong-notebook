import { masteryStatusOf } from "@/lib/mastery-status";

/** 一条待聚合的错题记录（接口只 select 这些轻字段，不读题干、图片等大字段） */
export interface WeakTagSourceItem {
    id: string;
    subjectId: string | null;
    subjectName: string | null;
    masteryProbability: number | null;
    tags: { name: string; tagSet: string }[];
    /** result 非空的举一反三记录数 */
    practiceRecordCount: number;
    /** 最近 30 天的练习记录 result（已按调用方过滤 source='duplicate_import'） */
    recentResults: (string | null)[];
}

/** 一组（同学科、同体系、同名标签）聚合结果 */
export interface WeakTagGroup {
    tag: string;
    tagSet: string;
    subjectId: string | null;
    subjectName: string;
    /** 该组范围内错题总数 */
    total: number;
    /** 待复习 + 复习中的错题数（不含已掌握） */
    unmastered: number;
    /** 近 30 天已作答次数（result 为 correct/wrong） */
    recentAttempted: number;
    /** 近 30 天答对次数 */
    recentCorrect: number;
    /** 近期错误率：1 - recentCorrect/recentAttempted，无记录视为 1 */
    recentErrorRate: number;
}

/** 接口返回的单个条目 */
export interface WeakTagEntry extends WeakTagGroup {
    /** 未掌握占比 0~1，用于进度条 */
    unmasteredRatio: number;
}

export interface BuildWeakTagsOptions {
    /** 用户已掌握阈值（百分比） */
    masteryThreshold: number;
}

function isAttemptedResult(result: string | null): result is 'correct' | 'wrong' {
    return result === 'correct' || result === 'wrong';
}

function groupKey(subjectId: string | null, tagSet: string, tagName: string): string {
    return JSON.stringify([subjectId, tagSet, tagName]);
}

/**
 * 把错题按（学科、体系、标签名）分组并排序，取未掌握数 > 0 的前 limit 个。
 * 排序：unmastered 降序 → 近期错误率降序 → total 降序 → 标签名（中文按拼音）。
 * 调用方负责：错题已按创建时间范围与学科筛选、recentResults 已限定在近 30 天且排除 duplicate_import。
 */
export function buildWeakTags(
    items: WeakTagSourceItem[],
    options: BuildWeakTagsOptions,
    limit = 10,
): WeakTagEntry[] {
    const { masteryThreshold } = options;
    const grouped = new Map<string, WeakTagGroup>();

    for (const item of items) {
        const status = masteryStatusOf(item.practiceRecordCount, item.masteryProbability, masteryThreshold);
        const isUnmastered = status !== 'mastered';
        let recentAttempted = 0;
        let recentCorrect = 0;
        for (const record of item.recentResults) {
            if (isAttemptedResult(record)) {
                recentAttempted += 1;
                if (record === 'correct') recentCorrect += 1;
            }
        }
        for (const tag of item.tags) {
            const key = groupKey(item.subjectId, tag.tagSet, tag.name);
            const entry = grouped.get(key);
            if (entry) {
                entry.total += 1;
                if (isUnmastered) entry.unmastered += 1;
                entry.recentAttempted += recentAttempted;
                entry.recentCorrect += recentCorrect;
            } else {
                grouped.set(key, {
                    tag: tag.name,
                    tagSet: tag.tagSet,
                    subjectId: item.subjectId,
                    subjectName: item.subjectName ?? 'Unknown',
                    total: 1,
                    unmastered: isUnmastered ? 1 : 0,
                    recentAttempted,
                    recentCorrect,
                    recentErrorRate: 0,
                });
            }
        }
    }

    const list: WeakTagGroup[] = [];
    for (const entry of grouped.values()) {
        if (entry.unmastered <= 0) continue;
        entry.recentErrorRate = entry.recentAttempted > 0
            ? 1 - entry.recentCorrect / entry.recentAttempted
            : 1;
        list.push(entry);
    }

    list.sort((a, b) =>
        b.unmastered - a.unmastered
        || b.recentErrorRate - a.recentErrorRate
        || b.total - a.total
        || a.tag.localeCompare(b.tag, 'zh'),
    );

    return list.slice(0, limit).map(entry => ({
        ...entry,
        unmasteredRatio: entry.total > 0 ? entry.unmastered / entry.total : 0,
    }));
}
