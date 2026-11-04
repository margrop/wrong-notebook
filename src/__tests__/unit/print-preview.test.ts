import { describe, expect, it } from 'vitest';
import {
    applyPrintSelection,
    chunk,
    matchesPrintSearch,
    fetchAllPages,
    getPrintableItemTagNames,
    getPrintPreviewCountLabel,
    getPrintPreviewEmptyState,
    getSelectedPrintItems,
    shouldReserveAnswerSpace,
} from '@/lib/print/print-preview';
import { DEFAULT_PRINT_OPTIONS, parseStoredPrintOptions } from '@/lib/print/print-preview-options';

describe('print preview helpers', () => {
    const items = [
        { id: 'item-1', questionText: '题目 1' },
        { id: 'item-2', questionText: '题目 2' },
        { id: 'item-3', questionText: '题目 3' },
    ];

    it('只返回当前选中的题目，并保持原顺序', () => {
        const selected = getSelectedPrintItems(items, new Set(['item-3', 'item-1']));

        expect(selected.map((item) => item.id)).toEqual(['item-1', 'item-3']);
    });

    it('只有在答案和解析都不显示时才预留作答空间', () => {
        expect(shouldReserveAnswerSpace(false, false)).toBe(true);
        expect(shouldReserveAnswerSpace(true, false)).toBe(false);
        expect(shouldReserveAnswerSpace(false, true)).toBe(false);
        expect(shouldReserveAnswerSpace(true, true)).toBe(false);
    });

    it('局部选择时显示已选数量和总数量', () => {
        expect(getPrintPreviewCountLabel(88, 88)).toBe('88');
        expect(getPrintPreviewCountLabel(88, 2)).toBe('2/88');
    });

    it('区分无匹配题目和有题但未选择', () => {
        expect(getPrintPreviewEmptyState(0, 0)).toBe('noItems');
        expect(getPrintPreviewEmptyState(88, 0)).toBe('noSelection');
        expect(getPrintPreviewEmptyState(88, 2)).toBeNull();
    });

    it('提取打印题目的知识点名称并兼容旧版 JSON 字符串', () => {
        expect(getPrintableItemTagNames({ tags: [{ name: '勾股定理' }], knowledgePoints: '["旧标签"]' }))
            .toEqual(['勾股定理']);
        expect(getPrintableItemTagNames({ tags: [], knowledgePoints: '["二次函数","配方法"]' }))
            .toEqual(['二次函数', '配方法']);
        expect(getPrintableItemTagNames({ tags: [], knowledgePoints: 'invalid-json' }))
            .toEqual([]);
    });
});

describe('打印预览读取全部题目', () => {
    const pageOf = (page: number, totalPages: number, items: string[]) => ({ items, total: 0, page, pageSize: 2, totalPages });

    it('逐页读取直到最后一页，保持顺序', async () => {
        const pages = [['a', 'b'], ['c', 'd'], ['e']];
        const requested: number[] = [];
        const items = await fetchAllPages(async (page) => {
            requested.push(page);
            return pageOf(page, 3, pages[page - 1]);
        });
        expect(items).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(requested).toEqual([1, 2, 3]);
    });

    it('没有题目时只请求一次', async () => {
        let calls = 0;
        expect(await fetchAllPages(async (page) => { calls += 1; return pageOf(page, 0, []); })).toEqual([]);
        expect(calls).toBe(1);
    });

    it('总页数变化导致返回空页时停止，不会无限请求', async () => {
        const items = await fetchAllPages(async (page) => pageOf(page, 99, page === 1 ? ['a'] : []));
        expect(items).toEqual(['a']);
    });

    it('按上限分批', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        expect(chunk([], 2)).toEqual([]);
    });
});

describe('打印选题搜索与批量选择', () => {
    const item = { questionText: '求解 Quadratic 方程', shortId: 'hA6PB9', tags: [{ name: '一元二次方程' }], knowledgePoints: null };

    it('按题目文字、编号或知识点匹配，忽略大小写', () => {
        expect(matchesPrintSearch(item, '  quadratic ')).toBe(true);
        expect(matchesPrintSearch(item, 'ha6pb9')).toBe(true);
        expect(matchesPrintSearch(item, '二次')).toBe(true);
        expect(matchesPrintSearch(item, '几何')).toBe(false);
        expect(matchesPrintSearch(item, '   ')).toBe(true);
    });

    it('全选、取消、反选只影响目标题目', () => {
        const selected = new Set(['a', 'c']);
        expect([...applyPrintSelection(selected, ['b'], 'select')].sort()).toEqual(['a', 'b', 'c']);
        expect([...applyPrintSelection(selected, ['a', 'b'], 'clear')]).toEqual(['c']);
        expect([...applyPrintSelection(selected, ['a', 'b'], 'invert')].sort()).toEqual(['b', 'c']);
        expect([...selected].sort()).toEqual(['a', 'c']);
    });
});

describe('打印显示选项本地保存', () => {
    it('读取合法字段，缺失或非法字段回退默认值', () => {
        expect(parseStoredPrintOptions(JSON.stringify({ showAnswers: true, imageScale: 55, answerSpace: 'large', showTags: 'yes' })))
            .toEqual({ ...DEFAULT_PRINT_OPTIONS, showAnswers: true, imageScale: 55, answerSpace: 'large' });
    });

    it('图片比例限制在 30%～100%，损坏数据返回默认值', () => {
        expect(parseStoredPrintOptions(JSON.stringify({ imageScale: 500 })).imageScale).toBe(100);
        expect(parseStoredPrintOptions(JSON.stringify({ answerSpace: 'huge' })).answerSpace).toBe('auto');
        expect(parseStoredPrintOptions('{broken')).toEqual(DEFAULT_PRINT_OPTIONS);
        expect(parseStoredPrintOptions(null)).toEqual(DEFAULT_PRINT_OPTIONS);
    });
});
