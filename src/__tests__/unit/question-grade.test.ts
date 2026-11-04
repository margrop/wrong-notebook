import { describe, expect, it } from 'vitest';
import { getQuestionGradeContext, needsQuestionGradeRecognition, resolveQuestionGrade } from '@/lib/question/question-grade';
import { parseGradeRecognition } from '@/lib/ai/schema';
import { generateAnalyzePrompt, generateReanswerPrompt } from '@/lib/ai/prompts';

describe('录入年级规则', () => {
    it('固定年级控制知识点范围、覆盖自动识别结果，但保留手工选择', () => {
        const profile = { gradeRecognitionMode: 'fixed', fixedGradeSemester: '四年级上' };
        expect(getQuestionGradeContext(profile)).toEqual({ grade: 4, gradeSemester: '四年级上' });
        expect(resolveQuestionGrade(profile, { recognizedGradeSemester: '高二下' })).toBe('四年级上');
        expect(resolveQuestionGrade(profile, { gradeSemester: '初一下' })).toBe('初一下');
        expect(resolveQuestionGrade(profile, { gradeSemester: '' })).toBeNull();
    });

    it('AI 模式不注入学生年级，无法判断时不回填学生当前年级', () => {
        const profile = { gradeRecognitionMode: 'ai', fixedGradeSemester: '四年级上', educationStage: 'junior_high', enrollmentYear: 2025 };
        expect(getQuestionGradeContext(profile)).toEqual({ grade: null, gradeSemester: null });
        expect(resolveQuestionGrade(profile, { recognizedGradeSemester: '高二下' })).toBe('高二下');
        expect(resolveQuestionGrade(profile, { recognizedGradeSemester: null })).toBeNull();
        expect(resolveQuestionGrade(profile, { gradeSemester: '自定义年级', recognizedGradeSemester: '高二下' })).toBe('自定义年级');
    });

    it('只为从未识别过年级的题目补充 AI 请求，手工清空和无法判断均不重试', () => {
        const profile = { gradeRecognitionMode: 'ai' };
        expect(needsQuestionGradeRecognition(profile, { questionText: '求和' })).toBe(true);
        for (const input of [{ questionText: '求和', gradeSemester: '' }, { questionText: '求和', recognizedGradeSemester: null }, { questionText: '' }]) {
            expect(needsQuestionGradeRecognition(profile, input)).toBe(false);
        }
        expect(needsQuestionGradeRecognition({}, { questionText: '求和' })).toBe(false);
    });

    it('统一解析短请求结果，拒绝越界与非标准年级，允许无法确定', () => {
        expect(parseGradeRecognition('```json\n{"gradeSemester":"四年级上"}\n```')).toBe('四年级上');
        expect(parseGradeRecognition('{"gradeSemester":null}')).toBeNull();
        expect(parseGradeRecognition('{"gradeSemester":"十三年级上"}')).toBeNull();
        expect(() => parseGradeRecognition('{}')).toThrow();
    });

    it('识别与文字解题的自定义提示词也遵守年级规则，英文界面使用统一存储值', () => {
        const image = generateAnalyzePrompt('en', null, null, { customTemplate: '自定义图片模板' });
        expect(image).toContain('<grade_semester>');
        expect(image).toContain('不要套用学生当前年级');
        const text = generateReanswerPrompt('en', 'question', undefined, { customTemplate: '自定义文字模板' }, '初二下');
        expect(text).toContain('固定年级学期为 初二下');
        expect(text).toContain('即使界面为英文也不得翻译');
    });
});
