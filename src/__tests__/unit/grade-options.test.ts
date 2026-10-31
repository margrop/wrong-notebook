/**
 * grade-options 单元测试
 * 测试学段年级映射与年级学期解析函数
 */
import { describe, it, expect } from 'vitest';
import { GRADE_NAMES, GRADE_SEMESTERS, STAGE_GRADE_RANGES, gradesForStage, parseGradeSemester } from '@/lib/grade-options';

describe('gradesForStage', () => {
    it('返回各学段的完整年级列表', () => {
        expect(gradesForStage('primary')).toEqual(['一年级', '二年级', '三年级', '四年级', '五年级', '六年级']);
        expect(gradesForStage('junior_high')).toEqual(['初一', '初二', '初三']);
        expect(gradesForStage('senior_high')).toEqual(['高一', '高二', '高三']);
        expect(gradesForStage('university')).toEqual(['大一', '大二', '大三', '大四']);
    });

    it('未知学段返回空数组', () => {
        expect(gradesForStage('unknown')).toEqual([]);
        expect(gradesForStage('')).toEqual([]);
    });

    it('所有学段年级合在一起等于完整 GRADE_NAMES', () => {
        const all = [
            ...gradesForStage('primary'),
            ...gradesForStage('junior_high'),
            ...gradesForStage('senior_high'),
            ...gradesForStage('university'),
        ];
        expect(all).toEqual([...GRADE_NAMES]);
    });
});

describe('parseGradeSemester', () => {
    it('解析「上」结尾的年级学期', () => {
        expect(parseGradeSemester('四年级上')).toEqual({ grade: '四年级', semester: '上' });
        expect(parseGradeSemester('初一上')).toEqual({ grade: '初一', semester: '上' });
    });

    it('解析「下」结尾的年级学期', () => {
        expect(parseGradeSemester('高二下')).toEqual({ grade: '高二', semester: '下' });
    });

    it('不带学期后缀返回 null', () => {
        expect(parseGradeSemester('四年级')).toBeNull();
    });

    it('空字符串返回 null', () => {
        expect(parseGradeSemester('')).toBeNull();
    });

    it('解析结果可通过 GRADE_SEMESTERS 校验', () => {
        for (const gs of ['四年级上', '初一下', '高三上', '大二下']) {
            const parsed = parseGradeSemester(gs);
            expect(parsed).not.toBeNull();
            expect(GRADE_SEMESTERS).toContain(gs);
        }
    });
});

describe('STAGE_GRADE_RANGES', () => {
    it('覆盖所有四个学段', () => {
        expect(Object.keys(STAGE_GRADE_RANGES)).toEqual(['primary', 'junior_high', 'senior_high', 'university']);
    });

    it('各学段范围互不重叠且连续', () => {
        const ranges = Object.values(STAGE_GRADE_RANGES);
        let prevEnd = 0;
        for (const { start, end } of ranges) {
            expect(start).toBe(prevEnd);
            expect(end).toBeGreaterThan(start);
            prevEnd = end;
        }
        expect(prevEnd).toBe(GRADE_NAMES.length);
    });
});
