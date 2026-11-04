/**
 * 小学数学课外拓展知识点与按年级选取标签单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { knowledgeTag: { findMany: mocks.findMany } } }));

import { MATH_CURRICULUM } from '@/lib/tags/data/math';
import { GAOSI_CHAPTER_NAME, MATH_GAOSI_EXTENSION } from '@/lib/tags/data/math-gaosi';
import { calculateGradeNumber } from '@/lib/tags/knowledge-tags';
import { getMathTagsFromDB } from '@/lib/ai/tag-service';

const PRIMARY_GRADES = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'];

describe('课外拓展知识点', () => {
    it('一至六年级末尾都追加了课外拓展章节，分上下册', () => {
        for (const grade of PRIMARY_GRADES) {
            const chapters = MATH_CURRICULUM[grade];
            const last = chapters[chapters.length - 1];
            expect(last.chapter).toBe(GAOSI_CHAPTER_NAME);
            expect(last.sections.map((section) => section.section)).toEqual(['高思上册', '高思下册']);
        }
    });

    it('课内章节保持不变，初高中不受影响', () => {
        expect(MATH_CURRICULUM['一年级'][0].chapter).toBe('数的认识');
        expect(MATH_CURRICULUM['七年级上'].some((chapter) => chapter.chapter === GAOSI_CHAPTER_NAME)).toBe(false);
    });

    it('与本年级课内同名的知识点不重复添加', () => {
        const schoolTags = MATH_CURRICULUM['一年级']
            .filter((chapter) => chapter.chapter !== GAOSI_CHAPTER_NAME)
            .flatMap((chapter) => chapter.sections.flatMap((section) => section.tags));
        const extensionTags = MATH_CURRICULUM['一年级']
            .find((chapter) => chapter.chapter === GAOSI_CHAPTER_NAME)!
            .sections.flatMap((section) => section.tags);

        expect(schoolTags).toContain('基数与序数');
        expect(extensionTags).not.toContain('基数与序数');
        expect(extensionTags).toContain('认识奇与偶');
    });

    it('同一年级课外拓展内没有重复或空白知识点', () => {
        for (const [grade, { upper, lower }] of Object.entries(MATH_GAOSI_EXTENSION)) {
            const all = [...upper, ...lower];
            expect(new Set(all).size, grade).toBe(all.length);
            expect(all.every((tag) => tag.trim().length > 0)).toBe(true);
        }
    });
});

describe('calculateGradeNumber 小学年级', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-18'));
    });

    it('按入学年份计算小学 1-6 年级', () => {
        expect(calculateGradeNumber('primary', 2026)).toBe(1);
        expect(calculateGradeNumber('primary', 2023)).toBe(4);
        expect(calculateGradeNumber('primary', 2021)).toBe(6);
        expect(calculateGradeNumber('primary', 2020)).toBeNull();
        vi.useRealTimers();
    });

    it('初中计算不受影响', () => {
        expect(calculateGradeNumber('junior_high', 2025)).toBe(8);
        vi.useRealTimers();
    });
});

describe('getMathTagsFromDB 按年级选取', () => {
    beforeEach(() => {
        mocks.findMany.mockReset();
        mocks.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    });

    const queriedGrades = () => mocks.findMany.mock.calls[0][0].where.name.in as string[];

    it('小学按年级累进，不含初高中', async () => {
        await getMathTagsFromDB(3);
        expect(queriedGrades()).toEqual(['一年级', '二年级', '三年级']);
    });

    it('无年级信息时仍只用初高中标签', async () => {
        await getMathTagsFromDB(null);
        expect(queriedGrades()).not.toContain('一年级');
        expect(queriedGrades()).toContain('七年级上');
        expect(queriedGrades()).toContain('高三');
    });

    it('返回所选年级下的叶子知识点', async () => {
        mocks.findMany.mockReset();
        mocks.findMany
            .mockResolvedValueOnce([{ id: 'g1' }])
            .mockResolvedValueOnce([
                { id: 'g1', name: '一年级', parentId: null },
                { id: 'c1', name: GAOSI_CHAPTER_NAME, parentId: 'g1' },
                { id: 's1', name: '高思下册', parentId: 'c1' },
                { id: 't1', name: '认识奇与偶', parentId: 's1' },
            ]);

        expect(await getMathTagsFromDB(1)).toEqual(['认识奇与偶']);
    });
});
