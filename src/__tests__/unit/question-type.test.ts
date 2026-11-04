import { describe, expect, it } from 'vitest';
import { normalizeQuestionType, QUESTION_TYPES } from '@/lib/question/question-type';

describe('normalizeQuestionType', () => {
    it('接受所有 QUESTION_TYPES 标准 key', () => {
        for (const key of QUESTION_TYPES) {
            expect(normalizeQuestionType(key)).toBe(key);
        }
    });

    it('中文别名映射正确', () => {
        expect(normalizeQuestionType('选择题')).toBe('single_choice');
        expect(normalizeQuestionType('单项选择')).toBe('single_choice');
        expect(normalizeQuestionType('单选题')).toBe('single_choice');
        expect(normalizeQuestionType('不定项')).toBe('multiple_choice');
        expect(normalizeQuestionType('不定项选择')).toBe('multiple_choice');
        expect(normalizeQuestionType('多项选择')).toBe('multiple_choice');
        expect(normalizeQuestionType('多选题')).toBe('multiple_choice');
        expect(normalizeQuestionType('判断')).toBe('true_false');
        expect(normalizeQuestionType('判断题')).toBe('true_false');
        expect(normalizeQuestionType('是非')).toBe('true_false');
        expect(normalizeQuestionType('是非题')).toBe('true_false');
        expect(normalizeQuestionType('填空')).toBe('fill_blank');
        expect(normalizeQuestionType('填空题')).toBe('fill_blank');
        expect(normalizeQuestionType('口算')).toBe('calculation');
        expect(normalizeQuestionType('计算')).toBe('calculation');
        expect(normalizeQuestionType('计算题')).toBe('calculation');
        expect(normalizeQuestionType('解答')).toBe('solution');
        expect(normalizeQuestionType('解答题')).toBe('solution');
        expect(normalizeQuestionType('应用')).toBe('solution');
        expect(normalizeQuestionType('应用题')).toBe('solution');
        expect(normalizeQuestionType('证明')).toBe('solution');
        expect(normalizeQuestionType('证明题')).toBe('solution');
        expect(normalizeQuestionType('简答')).toBe('solution');
        expect(normalizeQuestionType('简答题')).toBe('solution');
        expect(normalizeQuestionType('阅读')).toBe('reading');
        expect(normalizeQuestionType('阅读理解')).toBe('reading');
        expect(normalizeQuestionType('完形')).toBe('cloze');
        expect(normalizeQuestionType('完形填空')).toBe('cloze');
        expect(normalizeQuestionType('作文')).toBe('writing');
        expect(normalizeQuestionType('写作')).toBe('writing');
        expect(normalizeQuestionType('书面表达')).toBe('writing');
        expect(normalizeQuestionType('其他')).toBe('other');
    });

    it('英文别名映射正确（不区分大小写）', () => {
        expect(normalizeQuestionType('single choice')).toBe('single_choice');
        expect(normalizeQuestionType('Single Choice')).toBe('single_choice');
        expect(normalizeQuestionType('singlechoice')).toBe('single_choice');
        expect(normalizeQuestionType('single-choice')).toBe('single_choice');
        expect(normalizeQuestionType('multiple choice')).toBe('multiple_choice');
        expect(normalizeQuestionType('Multiple Choice')).toBe('multiple_choice');
        expect(normalizeQuestionType('multiplechoice')).toBe('multiple_choice');
        expect(normalizeQuestionType('multiple-choice')).toBe('multiple_choice');
        expect(normalizeQuestionType('multi choice')).toBe('multiple_choice');
        expect(normalizeQuestionType('multichoice')).toBe('multiple_choice');
        expect(normalizeQuestionType('true false')).toBe('true_false');
        expect(normalizeQuestionType('True / False')).toBe('true_false');
        expect(normalizeQuestionType('true/false')).toBe('true_false');
        expect(normalizeQuestionType('true-false')).toBe('true_false');
        expect(normalizeQuestionType('fill in the blank')).toBe('fill_blank');
        expect(normalizeQuestionType('fill-in-the-blank')).toBe('fill_blank');
        expect(normalizeQuestionType('fill_blank')).toBe('fill_blank');
        expect(normalizeQuestionType('fillblank')).toBe('fill_blank');
        expect(normalizeQuestionType('calculation')).toBe('calculation');
        expect(normalizeQuestionType('solution')).toBe('solution');
        expect(normalizeQuestionType('reading')).toBe('reading');
        expect(normalizeQuestionType('cloze')).toBe('cloze');
        expect(normalizeQuestionType('writing')).toBe('writing');
        expect(normalizeQuestionType('other')).toBe('other');
    });

    it('首尾空白被忽略', () => {
        expect(normalizeQuestionType('  single_choice  ')).toBe('single_choice');
        expect(normalizeQuestionType('  填空题  ')).toBe('fill_blank');
    });

    it('无法识别时返回 null', () => {
        expect(normalizeQuestionType('unknown')).toBeNull();
        expect(normalizeQuestionType('')).toBeNull();
        expect(normalizeQuestionType('   ')).toBeNull();
        expect(normalizeQuestionType(null)).toBeNull();
        expect(normalizeQuestionType(undefined)).toBeNull();
        expect(normalizeQuestionType(123)).toBeNull();
        expect(normalizeQuestionType({})).toBeNull();
        expect(normalizeQuestionType([])).toBeNull();
    });
});
