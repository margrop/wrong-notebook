import { describe, expect, it } from 'vitest';
import { batchDraftSchema, draftFromTextSplit, MAX_DRAFT_TEXT_LENGTH, MAX_ITEM_KNOWLEDGE_POINTS } from '@/lib/question-split/draft';
import type { BatchDraft, DraftItem } from '@/lib/question-split/draft';
import { mergeWithPrevious, splitItemAt, updateItem } from '@/lib/question-split/draft-ops';

function makeItem(patch: Partial<DraftItem> = {}): DraftItem {
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
        ...patch,
    };
}

describe('draft schema 新旧兼容', () => {
    it('旧草稿（无结构化字段）能通过校验', () => {
        const oldDraft: BatchDraft = {
            items: [makeItem()],
            ignored: [],
            warnings: [],
        };
        expect(batchDraftSchema.safeParse(oldDraft).success).toBe(true);
    });

    it('带结构化字段的草稿能通过校验', () => {
        const draft: BatchDraft = {
            items: [makeItem({
                answer: '2',
                analysis: '因为 1+1=2',
                knowledgePoints: ['加法'],
                difficultyStars: 3,
                questionType: 'calculation',
                wrongAnswer: '3',
            })],
            ignored: [],
            warnings: [],
        };
        expect(batchDraftSchema.safeParse(draft).success).toBe(true);
    });

    it('超长字段被拒绝', () => {
        const draft = {
            items: [makeItem({ answer: 'a'.repeat(MAX_DRAFT_TEXT_LENGTH + 1) })],
            ignored: [],
            warnings: [],
        };
        expect(batchDraftSchema.safeParse(draft).success).toBe(false);
    });

    it('知识点最多 100 个，每个最长 200', () => {
        const tooMany = {
            items: [makeItem({ knowledgePoints: Array.from({ length: MAX_ITEM_KNOWLEDGE_POINTS + 1 }, (_, i) => `point-${i}`) })],
            ignored: [],
            warnings: [],
        };
        expect(batchDraftSchema.safeParse(tooMany).success).toBe(false);
        const tooLong = {
            items: [makeItem({ knowledgePoints: ['a'.repeat(201)] })],
            ignored: [],
            warnings: [],
        };
        expect(batchDraftSchema.safeParse(tooLong).success).toBe(false);
    });

    it('difficultyStars 限定 1～5 的整数', () => {
        for (const value of [0, 6, 1.5]) {
            const draft = { items: [makeItem({ difficultyStars: value })], ignored: [], warnings: [] };
            expect(batchDraftSchema.safeParse(draft).success).toBe(false);
        }
    });

    it('draftFromTextSplit 把分题字段带入草稿', () => {
        const draft = draftFromTextSplit([
            { label: '1', text: '计算 1 + 1。', material: null, section: null, answer: '2', analysis: '因为 1+1=2', knowledgePoints: ['加法'], difficultyStars: 2, questionType: 'calculation', wrongAnswer: '3' },
        ], []);
        expect(draft.items[0].answer).toBe('2');
        expect(draft.items[0].analysis).toBe('因为 1+1=2');
        expect(draft.items[0].knowledgePoints).toEqual(['加法']);
        expect(draft.items[0].difficultyStars).toBe(2);
        expect(draft.items[0].questionType).toBe('calculation');
        expect(draft.items[0].wrongAnswer).toBe('3');
    });
});

describe('draft-ops 保留结构化字段', () => {
    it('合并时 answer/analysis/wrongAnswer 按换行拼接，知识点去重，难度与题型取第一题', () => {
        const draft: BatchDraft = {
            items: [
                makeItem({ key: 'q1', answer: '2', analysis: '解析一', knowledgePoints: ['加法'], difficultyStars: 3, questionType: 'calculation', wrongAnswer: '3' }),
                makeItem({ key: 'q2', answer: '4', analysis: '解析二', knowledgePoints: ['减法', '加法'], difficultyStars: 5, questionType: 'fill_blank', wrongAnswer: '5' }),
            ],
            ignored: [],
            warnings: [],
        };
        const merged = mergeWithPrevious(draft, 'q2');
        expect(merged.items).toHaveLength(1);
        const item = merged.items[0];
        expect(item.answer).toBe('2\n4');
        expect(item.analysis).toBe('解析一\n解析二');
        expect(item.knowledgePoints).toEqual(['加法', '减法']);
        expect(item.difficultyStars).toBe(3);
        expect(item.questionType).toBe('calculation');
        expect(item.wrongAnswer).toBe('3\n5');
    });

    it('拆分时结构化字段留在第一部分', () => {
        const draft: BatchDraft = {
            items: [makeItem({ key: 'q1', text: '前半部分\n后半部分', answer: '2', analysis: '解析', knowledgePoints: ['加法'], difficultyStars: 3, questionType: 'calculation', wrongAnswer: '3' })],
            ignored: [],
            warnings: [],
        };
        const offset = draft.items[0].text.indexOf('后半部分');
        const split = splitItemAt(draft, 'q1', offset);
        expect(split.items).toHaveLength(2);
        const [first, second] = split.items;
        expect(first.answer).toBe('2');
        expect(first.analysis).toBe('解析');
        expect(first.knowledgePoints).toEqual(['加法']);
        expect(first.difficultyStars).toBe(3);
        expect(first.questionType).toBe('calculation');
        expect(first.wrongAnswer).toBe('3');
        expect(second.answer).toBeNull();
        expect(second.analysis).toBeNull();
        expect(second.knowledgePoints).toBeUndefined();
        expect(second.difficultyStars).toBeNull();
        expect(second.questionType).toBeNull();
        expect(second.wrongAnswer).toBeNull();
    });

    it('updateItem 可编辑结构化字段并截断超长内容', () => {
        let draft: BatchDraft = { items: [makeItem({ key: 'q1' })], ignored: [], warnings: [] };
        draft = updateItem(draft, 'q1', { answer: '2', knowledgePoints: ['加法'], difficultyStars: 4, questionType: 'fill_blank' });
        expect(draft.items[0].answer).toBe('2');
        expect(draft.items[0].knowledgePoints).toEqual(['加法']);
        expect(draft.items[0].difficultyStars).toBe(4);
        expect(draft.items[0].questionType).toBe('fill_blank');
        draft = updateItem(draft, 'q1', { answer: null, difficultyStars: null, questionType: null });
        expect(draft.items[0].answer).toBeNull();
        expect(draft.items[0].difficultyStars).toBeNull();
        expect(draft.items[0].questionType).toBeNull();
    });
});
