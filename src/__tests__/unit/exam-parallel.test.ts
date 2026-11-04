/**
 * A/B 平行卷分配算法单元测试
 */
import { describe, it, expect } from 'vitest';

import { splitParallelSources, PARALLEL_NOT_ENOUGH } from '@/lib/exam/exam-parallel';

interface Item { id: string; questionType: string | null; difficultyStars: number | null }

const item = (id: string, questionType: string | null = null, difficultyStars: number | null = null): Item => ({ id, questionType, difficultyStars });
// 固定随机源，保证测试可重复
const noRandom = () => 0.5;

describe('splitParallelSources', () => {
    it('源题充足时 A 卷取 count 道，B 卷取剩余，互不重复且覆盖全部题目', () => {
        const sources = Array.from({ length: 12 }, (_, i) => item(`q${i + 1}`));
        const { paperA, paperB, warning } = splitParallelSources(sources, 6, noRandom);
        expect(warning).toBeNull();
        expect(paperA).toHaveLength(6);
        expect(paperB).toHaveLength(6);
        const all = [...paperA, ...paperB].map((i) => i.id);
        expect(new Set(all).size).toBe(12);
    });

    it('按题型分组轮流分配：A、B 卷题型数量接近', () => {
        // 12 题：8 道 choice、4 道 fill_blank
        const sources = [
            ...Array.from({ length: 8 }, (_, i) => item(`c${i + 1}`, 'single_choice')),
            ...Array.from({ length: 4 }, (_, i) => item(`f${i + 1}`, 'fill_blank')),
        ];
        const { paperA, paperB } = splitParallelSources(sources, 6, noRandom);
        const countBy = (items: Item[]) => items.reduce<Record<string, number>>((acc, i) => {
            acc[i.questionType ?? ''] = (acc[i.questionType ?? ''] ?? 0) + 1;
            return acc;
        }, {});
        const a = countBy(paperA);
        const b = countBy(paperB);
        // 每卷 4 道 choice + 2 道 fill_blank
        expect(a.single_choice).toBe(4);
        expect(a.fill_blank).toBe(2);
        expect(b.single_choice).toBe(4);
        expect(b.fill_blank).toBe(2);
    });

    it('同题型内按难度交替，两卷难度分布接近', () => {
        // 8 道同题型题，难度 1~5 交替
        const sources = [
            item('d1', 'solution', 1), item('d2', 'solution', 2),
            item('d3', 'solution', 3), item('d4', 'solution', 4),
            item('d5', 'solution', 5), item('d6', 'solution', 1),
            item('d7', 'solution', 2), item('d8', 'solution', 3),
        ];
        const { paperA, paperB } = splitParallelSources(sources, 4, noRandom);
        expect(paperA).toHaveLength(4);
        expect(paperB).toHaveLength(4);
        const sum = (items: Item[]) => items.reduce((acc, i) => acc + (i.difficultyStars ?? 0), 0);
        expect(Math.abs(sum(paperA) - sum(paperB))).toBeLessThanOrEqual(2);
    });

    it('源题不足 2×count 但足够 B 卷 1 题：返回 warning，B 卷少于 A 卷', () => {
        const sources = [item('a1'), item('a2'), item('b1'), item('b2'), item('b3')];
        const { paperA, paperB, warning } = splitParallelSources(sources, 3, noRandom);
        expect(warning).toBe(PARALLEL_NOT_ENOUGH);
        expect(paperA).toHaveLength(3);
        expect(paperB).toHaveLength(2);
        expect(new Set([...paperA, ...paperB].map((i) => i.id)).size).toBe(5);
    });

    it('连 B 卷 1 题都没有：B 卷为空数组，返回 warning', () => {
        const sources = [item('a1'), item('a2'), item('a3')];
        const { paperA, paperB, warning } = splitParallelSources(sources, 3, noRandom);
        expect(warning).toBe(PARALLEL_NOT_ENOUGH);
        expect(paperA).toHaveLength(3);
        expect(paperB).toHaveLength(0);
    });

    it('源题只有 1 道且 count=1：A 卷 1 道，B 卷空，warning', () => {
        const { paperA, paperB, warning } = splitParallelSources([item('only')], 1, noRandom);
        expect(warning).toBe(PARALLEL_NOT_ENOUGH);
        expect(paperA.map((i) => i.id)).toEqual(['only']);
        expect(paperB).toHaveLength(0);
    });

    it('恰为 2×count 时不返回 warning', () => {
        const sources = Array.from({ length: 10 }, (_, i) => item(`q${i + 1}`));
        const { paperA, paperB, warning } = splitParallelSources(sources, 5, noRandom);
        expect(warning).toBeNull();
        expect(paperA).toHaveLength(5);
        expect(paperB).toHaveLength(5);
    });

    it('两卷题目互不重复（多题型混合）', () => {
        const sources = [
            item('m1', 'single_choice', 2), item('m2', 'fill_blank', 4), item('m3', 'solution', 1),
            item('m4', 'single_choice', 5), item('m5', 'fill_blank', 3), item('m6', 'solution', 2),
            item('m7', 'single_choice', 1), item('m8', 'fill_blank', 5),
        ];
        const { paperA, paperB } = splitParallelSources(sources, 4, noRandom);
        const aIds = new Set(paperA.map((i) => i.id));
        const bIds = new Set(paperB.map((i) => i.id));
        for (const id of bIds) {
            expect(aIds.has(id)).toBe(false);
        }
    });

    it('各题型题数为奇数时两卷仍各得 count 道且不超过 count', () => {
        const sources = [
            item('s1', 'single_choice'), item('s2', 'single_choice'), item('s3', 'single_choice'),
            item('f1', 'fill_blank'), item('f2', 'fill_blank'),
            item('n1', null),
        ];
        const { paperA, paperB, warning } = splitParallelSources(sources, 3, () => 0.5);
        expect(warning).toBeNull();
        expect(paperA).toHaveLength(3);
        expect(paperB).toHaveLength(3);
        expect(new Set([...paperA, ...paperB].map((entry) => entry.id)).size).toBe(6);
        // 单选题两卷分别至少 1 道
        expect(paperA.some((entry) => entry.questionType === 'single_choice')).toBe(true);
        expect(paperB.some((entry) => entry.questionType === 'single_choice')).toBe(true);
    });
});
