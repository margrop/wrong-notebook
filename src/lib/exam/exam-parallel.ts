/**
 * A/B 平行卷分配算法。
 *
 * 把按同样条件选出的最多 2×count 道互不重复的源题分配到 A、B 两卷：
 * - A 卷最多 count 道，B 卷取剩余题目（可少于 A 卷）；
 * - 两卷题目互不重复；
 * - 尽量在题型分布与难度上均衡：按题型分组后，同题型内按难度排序交替分配给 A、B。
 */
import { sampleItems } from "@/lib/exam/exam";

/** 参与 A/B 卷分配的源题需要的最小信息 */
export interface ParallelSourceItem {
    id: string;
    /** 题型 key，null 表示未设置 */
    questionType: string | null;
    /** 难度星级 1~5，null 表示未评定 */
    difficultyStars: number | null;
}

/** 源题不足 2×count 时的响应提示码 */
export const PARALLEL_NOT_ENOUGH = 'PARALLEL_NOT_ENOUGH';

function difficultyRank(item: ParallelSourceItem): number {
    return item.difficultyStars ?? 0;
}

/**
 * 把选出的源题尽量均衡地分配到 A、B 两卷。
 *
 * 分配规则：
 * - 按题型分组（保持输入相对顺序）；
 * - 同题型组内先按难度升序（同难度内随机打乱）排序；
 * - 排序后的题目按奇偶位交替进入 A、B，使两卷在同题型内的难度分布接近；
 * - A 卷累计最多 count 道，超过后全部进入 B 卷（B 卷题数可少于 A 卷）。
 */
export function splitParallelSources<T extends ParallelSourceItem>(
    sources: T[],
    count: number,
    random: () => number = Math.random,
): { paperA: T[]; paperB: T[]; warning: typeof PARALLEL_NOT_ENOUGH | null } {
    const warning = sources.length < count * 2 ? PARALLEL_NOT_ENOUGH : null;
    // 按题型分组，保持输入顺序
    const groups = new Map<string, T[]>();
    for (const item of sources) {
        const key = item.questionType ?? '';
        const group = groups.get(key);
        if (group) {
            group.push(item);
        } else {
            groups.set(key, [item]);
        }
    }
    const paperA: T[] = [];
    const paperB: T[] = [];
    // 源题不足 2×count 时 A 优先拿满 count，B 拿剩余；否则按题型组内交替实现均衡
    const fillAFirst = sources.length < count * 2;
    for (const group of groups.values()) {
        const ordered = sampleItems(group, group.length, random)
            .sort((a, b) => difficultyRank(a) - difficultyRank(b));
        ordered.forEach((item) => {
            if (fillAFirst) {
                // 不足时先填满 A 卷，剩余进入 B 卷
                if (paperA.length < count) {
                    paperA.push(item);
                } else {
                    paperB.push(item);
                }
                return;
            }
            // 充足时跨题型连续交替：每题给当前题数较少的一卷（相同时给 A），
            // 组内已按难度排序，因此两卷的题型与难度分布都接近；任一卷不超过 count
            const toA = paperA.length <= paperB.length ? paperA.length < count : paperB.length >= count;
            (toA ? paperA : paperB).push(item);
        });
    }
    return { paperA, paperB, warning };
}
