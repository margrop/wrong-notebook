import { describe, expect, it } from 'vitest';
import { isGradeInStage, isValidNotebookScope, resolveNotebookScope, stageFromEducationStage, STAGE_SUBJECTS } from '@/lib/notebook-scope';

describe('错题本学段与学科', () => {
    it('年级节点按名称归入学段', () => {
        for (const name of ['一年级', '三年级', '六年级']) expect(isGradeInStage(name, 'primary')).toBe(true);
        for (const name of ['七年级', '七年级上', '九年级下']) expect(isGradeInStage(name, 'junior_high')).toBe(true);
        for (const name of ['高一上', '高二', '高三']) expect(isGradeInStage(name, 'senior_high')).toBe(true);
        expect(isGradeInStage('七年级上', 'primary')).toBe(false);
        expect(isGradeInStage('三年级', 'junior_high')).toBe(false);
        expect(isGradeInStage('高一上', 'junior_high')).toBe(false);
    });

    it('只允许标签库中存在的学段与学科组合', () => {
        expect(isValidNotebookScope('primary', 'math')).toBe(true);
        expect(isValidNotebookScope('primary', 'chinese')).toBe(true);
        expect(isValidNotebookScope('primary', 'physics')).toBe(false);
        expect(isValidNotebookScope('junior_high', 'physics')).toBe(true);
        expect(isValidNotebookScope('university', 'math')).toBe(false);
        expect(isValidNotebookScope('primary', 'music')).toBe(false);
        expect(isValidNotebookScope(undefined, undefined)).toBe(false);
        expect(STAGE_SUBJECTS.primary).toEqual(['math', 'english', 'chinese']);
    });

    it('旧错题本未记录学科时按名称推断，学段缺省为小学', () => {
        expect(resolveNotebookScope({ name: '初二数学', stage: null, subjectKey: null })).toEqual({ stage: 'primary', subject: 'math' });
        expect(resolveNotebookScope({ name: '我的错题', stage: 'senior_high', subjectKey: 'physics' })).toEqual({ stage: 'senior_high', subject: 'physics' });
        expect(resolveNotebookScope({ name: '综合', stage: 'junior_high' })).toEqual({ stage: 'junior_high', subject: null });
        expect(resolveNotebookScope({ name: '数学', stage: 'bogus', subjectKey: 'bogus' })).toEqual({ stage: 'primary', subject: 'math' });
    });

    it('用户的教育阶段映射为学段，大学或未设置时按小学', () => {
        expect(stageFromEducationStage('junior_high')).toBe('junior_high');
        expect(stageFromEducationStage('university')).toBe('primary');
        expect(stageFromEducationStage(null)).toBe('primary');
    });
});
