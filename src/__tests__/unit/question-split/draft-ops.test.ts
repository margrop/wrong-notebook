import { describe, expect, it } from 'vitest';
import { batchDraftSchema, boundingRegion, draftFromTextSplit, readyItems } from '@/lib/question-split/draft';
import type { BatchDraft } from '@/lib/question-split/draft';
import { addImageItem, duplicateItem, mergeWithPrevious, moveItem, removeItem, restoreIgnored, setAllSelected, splitItemAt, updateItem } from '@/lib/question-split/draft-ops';
import { splitQuestionText } from '@/lib/question-split/text';

function textDraft(): BatchDraft {
    const split = splitQuestionText('练习\n1．计算 1 + 1。\n2．计算 2 + 2。\n第二题后误粘的第三题：计算 3 + 3。\n3．计算 4 + 4。');
    return draftFromTextSplit(split.questions, split.ignored);
}

describe('分题草稿编辑', () => {
    it('文字分题结果转为草稿：全部选中，未计入的内容保留', () => {
        const draft = textDraft();
        expect(batchDraftSchema.safeParse(draft).success).toBe(true);
        expect(draft.items.map((item) => item.text)).toEqual(['计算 1 + 1。', '计算 2 + 2。\n第二题后误粘的第三题：计算 3 + 3。', '计算 4 + 4。']);
        expect(readyItems(draft, 'text')).toHaveLength(3);
        expect(draft.ignored).toEqual(['练习']);
    });

    it('在光标处拆开漏拆的题，再合并回去，内容不丢失', () => {
        const draft = textDraft();
        const target = draft.items[1];
        const offset = target.text.indexOf('第二题后');
        const split = splitItemAt(draft, target.key, offset);
        expect(split.items.map((item) => item.text)).toEqual(['计算 1 + 1。', '计算 2 + 2。', '第二题后误粘的第三题：计算 3 + 3。', '计算 4 + 4。']);
        expect(new Set(split.items.map((item) => item.key)).size).toBe(4);
        // 拆分点在开头或结尾时不拆
        expect(splitItemAt(draft, target.key, 0)).toBe(draft);
        const merged = mergeWithPrevious(split, split.items[2].key);
        expect(merged.items.map((item) => item.text)).toEqual(draft.items.map((item) => item.text));
        // 不能把第一题与上一题合并
        expect(mergeWithPrevious(draft, draft.items[0].key)).toBe(draft);
        // 原草稿未被修改（可撤销）
        expect(draft.items).toHaveLength(3);
    });

    it('选择、编辑、移动、删除与恢复未计入的内容', () => {
        let draft = textDraft();
        draft = setAllSelected(draft, false);
        expect(readyItems(draft, 'text')).toHaveLength(0);
        draft = updateItem(draft, draft.items[0].key, { selected: true, text: '已修改' });
        expect(readyItems(draft, 'text').map((item) => item.text)).toEqual(['已修改']);
        draft = moveItem(draft, draft.items[0].key, 1);
        expect(draft.items[1].text).toBe('已修改');
        expect(moveItem(draft, draft.items[0].key, -1)).toBe(draft);
        draft = removeItem(draft, draft.items[2].key);
        expect(draft.items).toHaveLength(2);
        draft = restoreIgnored(draft, 0);
        expect(draft.items.at(-1)).toMatchObject({ text: '练习', selected: true });
        expect(draft.ignored).toEqual([]);
        // 空题干的文字题不能选中开始
        draft = updateItem(draft, draft.items[0].key, { text: '   ', selected: true });
        expect(readyItems(draft, 'text').some((item) => item.key === draft.items[0].key)).toBe(false);
    });

    it('图片题：补上区域后不再是未定位；合并区域、复制一题、在原图上新增一题', () => {
        let draft: BatchDraft = {
            items: [
                { key: 'qa', label: '1', text: '题一', material: null, section: null, selected: true, regions: [{ x: 0, y: 0, width: 1, height: 0.3 }], hasFigure: true, flags: [] },
                { key: 'qb', label: null, text: '题一的配图', material: null, section: null, selected: false, regions: [], hasFigure: false, flags: ['unlocated'] },
            ],
            ignored: [], warnings: [],
        };
        expect(readyItems(draft, 'image').map((item) => item.key)).toEqual(['qa']);
        draft = updateItem(draft, 'qb', { regions: [{ x: 0, y: 0.35, width: 0.5, height: 0.2 }], selected: true });
        expect(draft.items[1].flags).toEqual([]);
        const merged = mergeWithPrevious(draft, 'qb');
        expect(merged.items).toHaveLength(1);
        expect(merged.items[0].regions).toHaveLength(2);
        expect(boundingRegion(merged.items[0].regions)).toEqual({ x: 0, y: 0, width: 1, height: 0.55 });
        const copied = duplicateItem(merged, 'qa');
        expect(copied.items).toHaveLength(2);
        expect(copied.items[1].regions).toEqual(merged.items[0].regions);
        const added = addImageItem(copied, { x: 0.1, y: 0.7, width: 0.8, height: 0.2 });
        expect(added.items.at(-1)).toMatchObject({ selected: true, regions: [{ x: 0.1, y: 0.7, width: 0.8, height: 0.2 }] });
        expect(updateItem(added, 'qa', { regions: [] }).items[0].flags).toContain('unlocated');
    });

    it('草稿校验拒绝越界区域与重复标识', () => {
        const base = textDraft();
        expect(batchDraftSchema.safeParse({ ...base, items: [base.items[0], { ...base.items[1], key: base.items[0].key }] }).success).toBe(false);
        expect(batchDraftSchema.safeParse({ ...base, items: [{ ...base.items[0], regions: [{ x: 0.8, y: 0, width: 0.5, height: 0.5 }] }] }).success).toBe(false);
    });
});
