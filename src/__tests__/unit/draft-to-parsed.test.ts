/**
 * 「按原样入库」：草稿条目转 ParsedQuestion 的纯函数单测
 */
import { describe, expect, it } from 'vitest';
import { draftItemToParsed } from '@/lib/import/draft-to-parsed';
import type { DraftItem } from '@/lib/question-split/draft';

function makeItem(overrides: Partial<DraftItem> = {}): DraftItem {
    return {
        key: 'q1',
        label: '1',
        text: '计算 1 + 1。',
        material: null,
        section: null,
        selected: true,
        regions: [],
        hasFigure: false,
        flags: [],
        ...overrides,
    };
}

describe('draftItemToParsed', () => {
    it('完整字段映射：题干、答案、解析、知识点、难度、错答', () => {
        const item = makeItem({
            text: '计算 1 + 1。',
            material: '公共材料内容',
            answer: '2',
            analysis: '1+1=2',
            knowledgePoints: ['加法', '整数运算'],
            difficultyStars: 3,
            wrongAnswer: '3',
        });
        const result = draftItemToParsed(item, { notebookName: '数学' });
        expect(result).not.toBeNull();
        expect(result!.questionText).toBe('公共材料内容\n\n计算 1 + 1。');
        expect(result!.answerText).toBe('2');
        expect(result!.analysis).toBe('1+1=2');
        expect(result!.knowledgePoints).toEqual(['加法', '整数运算']);
        expect(result!.difficultyStars).toBe(3);
        expect(result!.wrongAnswerText).toBe('3');
        expect(result!.mistakeStatus).toBe('wrong_attempt');
        expect(result!.subject).toBe('数学');
    });

    it('无答案、无解析时必填字段用占位空格（schema min(1) 要求），mistakeStatus 为 unknown', () => {
        const item = makeItem({ answer: null, analysis: null });
        const result = draftItemToParsed(item, { notebookName: '数学' });
        expect(result).not.toBeNull();
        expect(result!.answerText).toBe(' ');
        expect(result!.analysis).toBe(' ');
        expect(result!.mistakeStatus).toBe('unknown');
        expect(result!.wrongAnswerText).toBe('');
        expect(result!.knowledgePoints).toEqual([]);
        expect(result!.difficultyStars).toBeNull();
    });

    it('有错答时 mistakeStatus 为 wrong_attempt，没有错答时为 unknown', () => {
        const withWrong = draftItemToParsed(makeItem({ wrongAnswer: '答错了' }), { notebookName: '数学' });
        expect(withWrong!.mistakeStatus).toBe('wrong_attempt');
        const withoutWrong = draftItemToParsed(makeItem({ wrongAnswer: null }), { notebookName: '数学' });
        expect(withoutWrong!.mistakeStatus).toBe('unknown');
    });

    it('公共材料与题干拼接（与 composeQuestionInput 一致但不附答案小节）', () => {
        const item = makeItem({ text: '题目正文', material: '阅读材料' });
        const result = draftItemToParsed(item, { notebookName: '语文' });
        expect(result!.questionText).toBe('阅读材料\n\n题目正文');
    });

    it('无公共材料时 questionText 仅为题干', () => {
        const item = makeItem({ text: '只有题干', material: null });
        const result = draftItemToParsed(item, { notebookName: '英语' });
        expect(result!.questionText).toBe('只有题干');
    });

    it('错题本名称不在学科清单内时 subject 为「其他」', () => {
        const item = makeItem();
        const result = draftItemToParsed(item, { notebookName: '自定义错题本' });
        expect(result!.subject).toBe('其他');
    });

    it('未传 notebookName 时 subject 为「其他」', () => {
        const item = makeItem();
        const result = draftItemToParsed(item);
        expect(result!.subject).toBe('其他');
    });

    it('知识点去重并截断到 5 个', () => {
        const item = makeItem({
            knowledgePoints: ['加法', '减法', '加法', '乘法', '除法', '分数'],
        });
        const result = draftItemToParsed(item, { notebookName: '数学' });
        expect(result!.knowledgePoints).toEqual(['加法', '减法', '乘法', '除法', '分数']);
    });

    it('题干为空时返回 null', () => {
        const item = makeItem({ text: '   ' });
        expect(draftItemToParsed(item, { notebookName: '数学' })).toBeNull();
    });

    it('hasFigure 从草稿带入', () => {
        const item = makeItem({ hasFigure: true });
        const result = draftItemToParsed(item, { notebookName: '数学' });
        expect(result!.hasFigure).toBe(true);
    });

    it('草稿题型规范化后带入识别结果，无法识别时为空', () => {
        expect(draftItemToParsed(makeItem({ questionType: '选择题' }))?.questionType).toBe('single_choice');
        expect(draftItemToParsed(makeItem({ questionType: 'fill_blank' }))?.questionType).toBe('fill_blank');
        expect(draftItemToParsed(makeItem({ questionType: '奇怪的题型' }))?.questionType).toBeNull();
        expect(draftItemToParsed(makeItem())?.questionType).toBeNull();
    });
});
