/**
 * createStructuredImportBatches 的切分、幂等与错误处理
 */
import { describe, expect, it, vi } from 'vitest';
import {
    chunkStructuredItems,
    createStructuredImportBatches,
    MAX_STRUCTURED_ITEMS_TOTAL,
    needsAutoSplit,
    splitLongTextToStructuredItems,
} from '@/lib/import/structured-batches';

const { createImportBatchMock } = vi.hoisted(() => ({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    createImportBatchMock: vi.fn(async (input: { items?: unknown[] }, _clientRequestId?: string) => ({
        id: `batch-${Math.random().toString(36).slice(2, 10)}`,
        itemCount: input.items?.length ?? 0,
    })),
}));

vi.mock('@/lib/import/import-batch-client', () => ({
    createImportBatch: createImportBatchMock,
    newClientRequestId: vi.fn(() => `req-${Math.random().toString(36).slice(2, 10)}`),
    notifyImportTasksChanged: vi.fn(),
}));

describe('chunkStructuredItems', () => {
    it('按 60 题一组切分', () => {
        const items = Array.from({ length: 125 }, (_, i) => ({ text: `题目 ${i + 1}` }));
        const chunks = chunkStructuredItems(items);
        expect(chunks).toHaveLength(3);
        expect(chunks[0]).toHaveLength(60);
        expect(chunks[1]).toHaveLength(60);
        expect(chunks[2]).toHaveLength(5);
    });

    it('空数组返回空', () => {
        expect(chunkStructuredItems([])).toEqual([]);
    });

    it('图片总长度达到上限时提前开始新的一批，单题超限也独占一批', () => {
        const image = (length: number) => `data:image/jpeg;base64,${'A'.repeat(length)}`;
        const items = [
            { text: '1', image: image(400) },
            { text: '2', image: image(400) },
            { text: '3' },
            { text: '4', image: image(300) },
            { text: '5', image: image(2000) },
            { text: '6' },
        ];
        const chunks = chunkStructuredItems(items, 60, 1000);
        expect(chunks.map((chunk) => chunk.map((item) => item.text))).toEqual([['1', '2', '3'], ['4'], ['5'], ['6']]);
    });
});

describe('needsAutoSplit', () => {
    it('candidateCount 超过 60 时返回 true', () => {
        expect(needsAutoSplit({ candidateCount: 61, overflow: 0, tooLong: false })).toBe(true);
    });

    it('overflow 大于 0 时返回 true', () => {
        expect(needsAutoSplit({ candidateCount: 60, overflow: 1, tooLong: false })).toBe(true);
    });

    it('tooLong 为 true 时返回 true', () => {
        expect(needsAutoSplit({ candidateCount: 10, overflow: 0, tooLong: true })).toBe(true);
    });

    it('未超限时返回 false', () => {
        expect(needsAutoSplit({ candidateCount: 60, overflow: 0, tooLong: false })).toBe(false);
    });
});

describe('splitLongTextToStructuredItems', () => {
    it('把超长文字一次性分题，汇总为结构化题目（含 questionType）', () => {
        const lines = Array.from({ length: 130 }, (_, i) => `${i + 1}．计算 ${i + 1} + ${i + 1}。`);
        const text = lines.join('\n');
        const items = splitLongTextToStructuredItems(text);
        expect(items.length).toBe(130);
        expect(items[0].text).toContain('计算 1 + 1');
        expect(items[129].text).toContain('计算 130 + 130');
        expect(items.every((item) => item.questionType === null || item.questionType === undefined)).toBe(true);
    });

    it('答案区在全文末尾时，前面各题能拿到按题号回填的答案', () => {
        // 70 题 + 末尾答案区：第 1 批（前 60 题）的题也能拿到答案
        const lines = Array.from({ length: 70 }, (_, i) => `${i + 1}．计算 ${i + 1} + ${i + 1}。`);
        const answerLines = ['参考答案'];
        for (let i = 1; i <= 70; i++) answerLines.push(`${i}. ${i * 2}`);
        const text = [...lines, ...answerLines].join('\n');
        const items = splitLongTextToStructuredItems(text);
        expect(items.length).toBe(70);
        expect(items[0].answer).toBe('2');
        expect(items[59].answer).toBe('120');
        expect(items[69].answer).toBe('140');
    });

    it('带大题标题与公共材料的长文字，分批后 section/material 不丢', () => {
        const lines: string[] = [];
        lines.push('一、选择题');
        lines.push('阅读下面的材料，回答 1～3 题。');
        lines.push('某商店上午卖出 30 件，下午卖出 45 件。');
        for (let i = 1; i <= 3; i++) lines.push(`${i}．第 ${i} 题。`);
        lines.push('二、填空题');
        lines.push('计算 4 + 4。');
        for (let i = 4; i <= 65; i++) lines.push(`${i}．计算 ${i} + ${i}。`);
        const text = lines.join('\n');
        const items = splitLongTextToStructuredItems(text);
        expect(items.length).toBe(65);
        // 公共材料只作用于所属题组
        const withMaterial = items.filter((item) => item.material?.includes('某商店'));
        expect(withMaterial.length).toBe(3);
        // 大题标题保留
        const firstSection = items.find((item) => item.section?.includes('一、选择题'));
        expect(firstSection).toBeDefined();
        const secondSection = items.find((item) => item.section?.includes('二、填空题'));
        expect(secondSection).toBeDefined();
    });

    it('超过 100 万字时抛错', () => {
        // 70 行 × 15000 字 = 105 万字 > 100 万上限
        const lines = Array.from({ length: 70 }, (_, i) => `${i + 1}．${'字'.repeat(15000)}`);
        expect(() => splitLongTextToStructuredItems(lines.join('\n'))).toThrow('TEXT_TOO_LONG_FOR_AUTO_SPLIT');
    });

    it('splitQuestionText 返回 overflow 时抛错（mock 模拟 2000 题以上）', async () => {
        const textModule = await import('@/lib/question-split/text');
        const spy = vi.spyOn(textModule, 'splitQuestionText');
        spy.mockReturnValueOnce({
            questions: [],
            ignored: [],
            detected: true,
            ambiguous: false,
            candidateCount: 2001,
            overflow: 1,
            tooLong: false,
        });
        expect(() => splitLongTextToStructuredItems('1．a\n2．b')).toThrow('TOO_MANY_QUESTIONS_FOR_AUTO_SPLIT');
        spy.mockRestore();
    });
});

describe('createStructuredImportBatches', () => {
    it('空数组抛错', async () => {
        await expect(createStructuredImportBatches([], { language: 'zh' })).rejects.toThrow('STRUCTURED_ITEMS_EMPTY');
    });

    it('超过总数上限抛错', async () => {
        const items = Array.from({ length: MAX_STRUCTURED_ITEMS_TOTAL + 1 }, (_, i) => ({ text: `题目 ${i + 1}` }));
        await expect(createStructuredImportBatches(items, { language: 'zh' })).rejects.toThrow('STRUCTURED_ITEMS_TOO_MANY');
    });

    it('按 60 题一组分批创建，返回批次列表与 prefix', async () => {
        createImportBatchMock.mockClear();
        const items = Array.from({ length: 125 }, (_, i) => ({ text: `题目 ${i + 1}` }));
        const { batches, failures, clientRequestIdPrefix } = await createStructuredImportBatches(items, { language: 'zh' });
        expect(batches).toHaveLength(3);
        expect(failures).toHaveLength(0);
        expect(clientRequestIdPrefix).toMatch(/^sb-/);
        // 每片的 clientRequestId 为 `${prefix}-${index}`
        expect(createImportBatchMock.mock.calls[0][1]).toBe(`${clientRequestIdPrefix}-0`);
        expect(createImportBatchMock.mock.calls[1][1]).toBe(`${clientRequestIdPrefix}-1`);
        expect(createImportBatchMock.mock.calls[2][1]).toBe(`${clientRequestIdPrefix}-2`);
    });

    it('显式传入 prefix 时，同一次导入重试请求的 clientRequestId 相同（幂等）', async () => {
        createImportBatchMock.mockClear();
        const items = Array.from({ length: 65 }, (_, i) => ({ text: `题目 ${i + 1}` }));
        const prefix = 'my-fixed-prefix';
        const first = await createStructuredImportBatches(items, { language: 'zh', clientRequestIdPrefix: prefix });
        expect(first.clientRequestIdPrefix).toBe(prefix);
        expect(createImportBatchMock.mock.calls[0][1]).toBe(`${prefix}-0`);
        expect(createImportBatchMock.mock.calls[1][1]).toBe(`${prefix}-1`);
        // 重试（相同 prefix）时 clientRequestId 不变
        createImportBatchMock.mockClear();
        const retry = await createStructuredImportBatches(items, { language: 'zh', clientRequestIdPrefix: prefix });
        expect(retry.clientRequestIdPrefix).toBe(prefix);
        expect(createImportBatchMock.mock.calls[0][1]).toBe(`${prefix}-0`);
        expect(createImportBatchMock.mock.calls[1][1]).toBe(`${prefix}-1`);
    });

    it('单批失败不影响其他批次', async () => {
        createImportBatchMock.mockClear();
        createImportBatchMock.mockRejectedValueOnce(new Error('network error'));
        const items = Array.from({ length: 125 }, (_, i) => ({ text: `题目 ${i + 1}` }));
        const { batches, failures } = await createStructuredImportBatches(items, { language: 'zh' });
        expect(batches).toHaveLength(2);
        expect(failures).toHaveLength(1);
        expect(failures[0].index).toBe(0);
        expect(failures[0].items).toHaveLength(60);
    });
});
