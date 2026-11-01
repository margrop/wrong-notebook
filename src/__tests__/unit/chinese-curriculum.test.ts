import { describe, expect, it } from 'vitest';
import { isGradeInStage, isValidNotebookScope, NOTEBOOK_STAGES } from '@/lib/notebook-scope';
import { CHINESE_CURRICULUM, CHINESE_GRADE_ORDER } from '@/lib/tag-data/chinese';

describe('语文课程与错题本学段', () => {
    it('小学、初中和高中都可以创建语文错题本', () => {
        for (const stage of NOTEBOOK_STAGES) {
            expect(isValidNotebookScope(stage, 'chinese')).toBe(true);
        }
    });

    it('每个学段都有非空的年级、章节和知识点', () => {
        for (const stage of NOTEBOOK_STAGES) {
            const grades = Object.entries(CHINESE_CURRICULUM).filter(([grade]) => isGradeInStage(grade, stage));
            expect(grades.length).toBeGreaterThan(0);
            for (const [, chapters] of grades) {
                expect(chapters.length).toBeGreaterThan(0);
                expect(new Set(chapters.map(({ chapter }) => chapter)).size).toBe(chapters.length);
                for (const { chapter, tags } of chapters) {
                    expect(chapter.trim()).not.toBe('');
                    expect(tags.length).toBeGreaterThan(0);
                    expect(tags.every((tag) => tag.trim().length > 0)).toBe(true);
                    expect(new Set(tags).size).toBe(tags.length);
                }
            }
        }
    });

    it('小学覆盖一年级到六年级，课程年级与排序一致', () => {
        const primaryGrades = Object.keys(CHINESE_CURRICULUM).filter((grade) => isGradeInStage(grade, 'primary'));
        expect(primaryGrades).toEqual(['一年级', '二年级', '三年级', '四年级', '五年级', '六年级']);
        expect(Object.keys(CHINESE_GRADE_ORDER)).toEqual(Object.keys(CHINESE_CURRICULUM));
        const orders = Object.values(CHINESE_GRADE_ORDER);
        expect(orders).toEqual([...orders].sort((a, b) => a - b));
        expect(new Set(orders).size).toBe(orders.length);
        expect(CHINESE_CURRICULUM['一年级']).toContainEqual(expect.objectContaining({
            chapter: '汉语拼音', tags: expect.arrayContaining(['声母', '韵母', '声调']),
        }));
    });
});
