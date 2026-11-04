import { describe, expect, it } from 'vitest';
import { groupExamQuestions } from '@/lib/exam/exam-sections';
import type { ExamSectionQuestion } from '@/lib/exam/exam-sections';

function q(
    id: string,
    order: number,
    questionType: string | null,
    extra: Partial<ExamSectionQuestion> = {},
): ExamSectionQuestion {
    return { id, order, questionType, ...extra };
}

describe('groupExamQuestions 按题型分大题', () => {
    it('按 QUESTION_TYPES 顺序分组，组内保持卷内 order，空组不返回', () => {
        const questions = [
            q('a', 0, 'solution'),
            q('b', 1, 'single_choice'),
            q('c', 2, 'single_choice'),
            q('d', 3, 'fill_blank'),
        ];
        const sections = groupExamQuestions(questions, 'zh');
        expect(sections.map((section) => section.type)).toEqual(['single_choice', 'fill_blank', 'solution']);
        expect(sections.map((section) => section.title)).toEqual(['一、单选题', '二、填空题', '三、解答题']);
        expect(sections[0].items.map((item) => item.question.id)).toEqual(['b', 'c']);
        expect(sections[1].items.map((item) => item.question.id)).toEqual(['d']);
        expect(sections[2].items.map((item) => item.question.id)).toEqual(['a']);
        // 不受传入顺序影响（乱序输入也按 order 稳定排序）
        const shuffled = groupExamQuestions([questions[3], questions[0], questions[2], questions[1]], 'zh');
        expect(shuffled.map((section) => section.type)).toEqual(['single_choice', 'fill_blank', 'solution']);
        expect(shuffled[0].items.map((item) => item.question.id)).toEqual(['b', 'c']);
    });

    it('全卷连续编号：displayNumber 跨大题递增，从 1 开始', () => {
        const questions = [
            q('a', 0, 'single_choice'),
            q('b', 1, 'single_choice'),
            q('c', 2, 'fill_blank'),
            q('d', 3, 'solution'),
        ];
        const sections = groupExamQuestions(questions, 'zh');
        const numbers = sections.flatMap((section) => section.items.map((item) => item.displayNumber));
        expect(numbers).toEqual([1, 2, 3, 4]);
    });

    it('快照 questionType 为 null 时回退读取关联错题当前题型', () => {
        const questions = [
            q('a', 0, null, { errorItemQuestionType: 'calculation' }),
            q('b', 1, 'fill_blank'),
        ];
        const sections = groupExamQuestions(questions, 'zh');
        expect(sections.map((section) => section.type)).toEqual(['fill_blank', 'calculation']);
        expect(sections[1].title).toBe('二、计算题');
    });

    it('快照为空且关联题型也为空（或未知）时归入「其他」', () => {
        const questions = [
            q('a', 0, null),
            q('b', 1, null, { errorItemQuestionType: 'not_a_type' }),
            q('c', 2, 'single_choice'),
        ];
        const sections = groupExamQuestions(questions, 'zh');
        expect(sections.map((section) => section.type)).toEqual(['single_choice', null]);
        expect(sections[1].title).toBe('二、其他');
        expect(sections[1].items.map((item) => item.question.id)).toEqual(['a', 'b']);
        // 快照优先于关联错题当前题型
        const snapshotWins = groupExamQuestions([q('a', 0, 'solution', { errorItemQuestionType: 'calculation' })], 'zh');
        expect(snapshotWins[0].type).toBe('solution');
    });

    it('分值小计只累加已设分值，无分值时 scoreTotal 为 null 且 unscored 正确', () => {
        const questions = [
            q('a', 0, 'single_choice'),
            q('b', 1, 'single_choice'),
            q('c', 2, 'single_choice'),
        ];
        const none = groupExamQuestions(questions, 'zh');
        expect(none[0]).toMatchObject({ count: 3, scoreTotal: null, unscored: 3 });

        const scored = groupExamQuestions(
            [
                { ...q('a', 0, 'single_choice'), score: 2 },
                { ...q('b', 1, 'single_choice'), score: 2.5 },
                q('c', 2, 'single_choice'),
            ],
            'zh',
        );
        expect(scored[0]).toMatchObject({ count: 3, scoreTotal: 4.5, unscored: 1 });
    });

    it('英文大题标题使用 Part I. 风格', () => {
        const questions = [
            q('a', 0, 'single_choice'),
            q('b', 1, 'fill_blank'),
            q('c', 2, 'solution'),
        ];
        const sections = groupExamQuestions(questions, 'en');
        expect(sections.map((section) => section.title)).toEqual([
            'Part I. Single Choice',
            'Part II. Fill in the Blank',
            'Part III. Solution',
        ]);
    });

    it('空数组返回空分组', () => {
        expect(groupExamQuestions([], 'zh')).toEqual([]);
    });
});
