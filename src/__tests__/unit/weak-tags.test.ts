/**
 * src/lib/tags/weak-tags.ts 单元测试
 * 覆盖分组、未掌握判定、近期正确率、排序与截断逻辑
 */
import { describe, it, expect } from 'vitest';
import { buildWeakTags, type WeakTagSourceItem } from '@/lib/tags/weak-tags';


function makeItem(overrides: Partial<WeakTagSourceItem> = {}): WeakTagSourceItem {
    return {
        id: 'item-1',
        subjectId: 'sub-1',
        subjectName: '数学',
        masteryProbability: null,
        tags: [{ name: '一元一次方程', tagSet: 'default' }],
        practiceRecordCount: 0,
        recentResults: [],
        ...overrides,
    };
}

describe('buildWeakTags', () => {
    it('空输入返回空数组', () => {
        expect(buildWeakTags([], { masteryThreshold: 50 })).toEqual([]);
    });

    it('没有标签的错题不参与分组', () => {
        const items = [makeItem({ tags: [] })];
        expect(buildWeakTags(items, { masteryThreshold: 50 })).toEqual([]);
    });

    it('全部已掌握时不返回该组', () => {
        const items = [makeItem({ practiceRecordCount: 2, masteryProbability: 0.9 })];
        expect(buildWeakTags(items, { masteryThreshold: 50 })).toEqual([]);
    });

    it('待复习（无练习记录）计入 unmastered', () => {
        const items = [makeItem({ practiceRecordCount: 0, masteryProbability: null })];
        const result = buildWeakTags(items, { masteryThreshold: 50 });
        expect(result).toHaveLength(1);
        expect(result[0].unmastered).toBe(1);
        expect(result[0].total).toBe(1);
        expect(result[0].unmasteredRatio).toBe(1);
        // 无近期记录：错误率视为 1
        expect(result[0].recentErrorRate).toBe(1);
        expect(result[0].recentAttempted).toBe(0);
    });

    it('复习中（低于阈值）计入 unmastered', () => {
        const items = [makeItem({ practiceRecordCount: 1, masteryProbability: 0.3 })];
        const result = buildWeakTags(items, { masteryThreshold: 50 });
        expect(result[0].unmastered).toBe(1);
    });

    it('达到用户阈值的错题视为已掌握，不计入 unmastered', () => {
        // 阈值 60，掌握概率 0.6 视为已掌握
        const items = [makeItem({ practiceRecordCount: 1, masteryProbability: 0.6 })];
        expect(buildWeakTags(items, { masteryThreshold: 60 })).toEqual([]);
    });

    it('按（学科、体系、标签名）分组，同学科同体系同名标签合并', () => {
        const items = [
            makeItem({ id: 'a', tags: [{ name: '方程', tagSet: 'default' }] }),
            makeItem({ id: 'b', tags: [{ name: '方程', tagSet: 'default' }] }),
            // 不同体系：不合并
            makeItem({ id: 'c', tags: [{ name: '方程', tagSet: 'cnm' }] }),
            // 不同学科：不合并
            makeItem({ id: 'd', subjectId: 'sub-2', subjectName: '物理', tags: [{ name: '方程', tagSet: 'default' }] }),
        ];
        const result = buildWeakTags(items, { masteryThreshold: 50 });
        expect(result).toHaveLength(3);
        const bySet = (tagSet: string, subjectId: string | null) =>
            result.find(r => r.tagSet === tagSet && r.subjectId === subjectId);
        expect(bySet('default', 'sub-1')?.total).toBe(2);
        expect(bySet('cnm', 'sub-1')?.total).toBe(1);
        expect(bySet('default', 'sub-2')?.total).toBe(1);
    });

    it('一道错题多个标签时在每个标签下都计数', () => {
        const items = [makeItem({
            tags: [
                { name: '方程', tagSet: 'default' },
                { name: '代数', tagSet: 'default' },
            ],
        })];
        const result = buildWeakTags(items, { masteryThreshold: 50 });
        expect(result).toHaveLength(2);
        expect(result.every(r => r.total === 1 && r.unmastered === 1)).toBe(true);
    });

    it('统计 recentAttempted / recentCorrect，只计 correct/wrong 结果', () => {
        const items = [makeItem({
            practiceRecordCount: 4,
            masteryProbability: 0.2,
            recentResults: ['correct', 'wrong', 'not_attempted', null],
        })];
        const result = buildWeakTags(items, { masteryThreshold: 50 });
        expect(result[0].recentAttempted).toBe(2);
        expect(result[0].recentCorrect).toBe(1);
        expect(result[0].recentErrorRate).toBeCloseTo(0.5, 5);
    });

    it('排序：先按 unmastered 降序', () => {
        const items = [
            makeItem({ id: 'a', tags: [{ name: 'B', tagSet: 'default' }], practiceRecordCount: 1, masteryProbability: 0.1 }),
            makeItem({ id: 'b', tags: [{ name: 'A', tagSet: 'default' }], practiceRecordCount: 0, masteryProbability: null }),
            makeItem({ id: 'c', tags: [{ name: 'A', tagSet: 'default' }], practiceRecordCount: 0, masteryProbability: null }),
        ];
        const result = buildWeakTags(items, { masteryThreshold: 50 });
        expect(result.map(r => r.tag)).toEqual(['A', 'B']);
        expect(result[0].unmastered).toBe(2);
        expect(result[1].unmastered).toBe(1);
    });

    it('排序：unmastered 相同时按近期错误率降序（无记录视为 1）', () => {
        const items = [
            // 全部答对：错误率 0
            makeItem({ id: 'a', tags: [{ name: '全对', tagSet: 'default' }], practiceRecordCount: 1, masteryProbability: 0.1, recentResults: ['correct'] }),
            // 部分答对：错误率 0.5
            makeItem({ id: 'b', tags: [{ name: '半对', tagSet: 'default' }], practiceRecordCount: 2, masteryProbability: 0.1, recentResults: ['correct', 'wrong'] }),
            // 无记录：错误率 1
            makeItem({ id: 'c', tags: [{ name: '无记录', tagSet: 'default' }], practiceRecordCount: 1, masteryProbability: 0.1, recentResults: [] }),
        ];
        const result = buildWeakTags(items, { masteryThreshold: 50 });
        expect(result.map(r => r.tag)).toEqual(['无记录', '半对', '全对']);
    });

    it('排序：unmastered 与错误率相同时按 total 降序', () => {
        const items = [
            makeItem({ id: 'a', tags: [{ name: '少', tagSet: 'default' }], practiceRecordCount: 1, masteryProbability: 0.1 }),
            makeItem({ id: 'b1', tags: [{ name: '多', tagSet: 'default' }], practiceRecordCount: 1, masteryProbability: 0.9 }),
            makeItem({ id: 'b2', tags: [{ name: '多', tagSet: 'default' }], practiceRecordCount: 0, masteryProbability: null }),
        ];
        const result = buildWeakTags(items, { masteryThreshold: 50 });
        expect(result.map(r => r.tag)).toEqual(['多', '少']);
        expect(result[0].total).toBe(2);
        expect(result[0].unmastered).toBe(1);
    });

    it('只返回 unmastered > 0 的组，且最多 10 条', () => {
        const items: WeakTagSourceItem[] = [];
        for (let i = 0; i < 15; i++) {
            items.push(makeItem({
                id: `tag-${i}`,
                tags: [{ name: `标签${i}`, tagSet: 'default' }],
                practiceRecordCount: 0,
                masteryProbability: null,
            }));
        }
        // 全部已掌握的组不应出现
        items.push(makeItem({
            id: 'mastered-item',
            tags: [{ name: '已掌握', tagSet: 'default' }],
            practiceRecordCount: 2,
            masteryProbability: 0.9,
        }));
        const result = buildWeakTags(items, { masteryThreshold: 50 });
        expect(result).toHaveLength(10);
        expect(result.every(r => r.unmastered > 0)).toBe(true);
        expect(result.some(r => r.tag === '已掌握')).toBe(false);
    });

    it('subjectId 为 null 时仍可分组，subjectName 回退 Unknown', () => {
        const items = [makeItem({ subjectId: null, subjectName: null })];
        const result = buildWeakTags(items, { masteryThreshold: 50 });
        expect(result[0].subjectId).toBeNull();
        expect(result[0].subjectName).toBe('Unknown');
    });
});
