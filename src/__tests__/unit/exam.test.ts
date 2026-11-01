/**
 * 错题试卷逻辑与打印导出单元测试
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/ai', () => ({ getAIService: vi.fn() }));

import { buildSourceWhere, pickLeastPracticed, sampleItems, summarizePaperStatus } from '@/lib/exam';
import { buildExamHtmlDocument, examFileName, KATEX_CSS_URL } from '@/lib/exam-print';
import { regionFromPoints } from '@/lib/image-crop';

describe('buildSourceWhere', () => {
    const MASTERED = { practiceRecords: { some: { result: { not: null } } }, masteryProbability: { gte: 0.5 } };

    it('未掌握范围选待复习和复习中的题', () => {
        const where = buildSourceWhere('u1', { subjectIds: ['s1'], scope: 'unmastered', count: 5 });
        expect(where).toMatchObject({ userId: 'u1', subjectId: { in: ['s1'] }, NOT: MASTERED, shortId: { not: null } });
    });

    it('已掌握范围选已掌握的题，并可按知识点过滤', () => {
        const where = buildSourceWhere('u1', { subjectIds: ['s1', 's2'], scope: 'mastered', count: 5, tagNames: ['函数'] });
        expect(where.AND).toEqual([MASTERED]);
        expect(where.tags).toEqual({ some: { name: { in: ['函数'] } } });
    });

    it('按用户的已掌握阈值划分掌握范围', () => {
        const where = buildSourceWhere('u1', { subjectIds: ['s1'], scope: 'mastered', count: 5 }, 80);
        expect(where.AND).toEqual([{ ...MASTERED, masteryProbability: { gte: 0.8 } }]);
    });

    it('全部范围不限制掌握状态', () => {
        const where = buildSourceWhere('u1', { subjectIds: ['s1'], scope: 'all', count: 5 });
        expect(where).not.toHaveProperty('NOT');
        expect(where).not.toHaveProperty('AND');
        expect(where).not.toHaveProperty('tags');
    });
});

describe('sampleItems', () => {
    it('不足题量时返回全部且不重复', () => {
        const result = sampleItems([1, 2, 3], 10);
        expect([...result].sort()).toEqual([1, 2, 3]);
    });

    it('按题量截取', () => {
        expect(sampleItems([1, 2, 3, 4, 5], 2)).toHaveLength(2);
    });
});

describe('pickLeastPracticed', () => {
    const items = [
        { id: 'a', practiceCount: 3 },
        { id: 'b', practiceCount: 0 },
        { id: 'c', practiceCount: 1 },
        { id: 'd', practiceCount: 0 },
    ];

    it('按练习次数从少到多选取', () => {
        const picked = pickLeastPracticed(items, 3);
        expect(picked.slice(0, 2).map((item) => item.id).sort()).toEqual(['b', 'd']);
        expect(picked[2].id).toBe('c');
    });

    it('练习次数相同的题目之间随机', () => {
        const first = new Set(Array.from({ length: 50 }, () => pickLeastPracticed(items, 1)[0].id));
        expect(first).toEqual(new Set(['b', 'd']));
    });

    it('练习次数相同时优先选择未出现在已有试卷中的题目', () => {
        const candidates = [
            { id: 'in-exam-0', practiceCount: 0, inExam: true },
            { id: 'fresh-0', practiceCount: 0, inExam: false },
            { id: 'in-exam-1', practiceCount: 1, examCount: 2 },
            { id: 'fresh-1', practiceCount: 1, examCount: 0 },
        ];
        const picked = pickLeastPracticed(candidates, 4);
        expect(picked.map((item) => item.id)).toEqual(['fresh-0', 'in-exam-0', 'fresh-1', 'in-exam-1']);
    });

    it('同练习次数且都未进过试卷（或都进过试卷）时保持随机', () => {
        const candidates = [
            { id: 'used-a', practiceCount: 1, inExam: true },
            { id: 'used-b', practiceCount: 1, inExam: true },
            { id: 'fresh-a', practiceCount: 1, inExam: false },
            { id: 'fresh-b', practiceCount: 1, inExam: false },
        ];
        const firstChoice = new Set(Array.from({ length: 50 }, () => pickLeastPracticed(candidates, 1)[0].id));
        expect(firstChoice).toEqual(new Set(['fresh-a', 'fresh-b']));
        const thirdChoice = new Set(Array.from({ length: 50 }, () => pickLeastPracticed(candidates, 3)[2].id));
        expect(thirdChoice).toEqual(new Set(['used-a', 'used-b']));
    });

    it('不足题量时返回全部', () => {
        expect(pickLeastPracticed(items, 10)).toHaveLength(4);
    });
});

describe('summarizePaperStatus', () => {
    it('存在待生成题目时为生成中', () => {
        expect(summarizePaperStatus(['ready', 'pending'])).toBe('generating');
    });

    it('全部成功、部分失败、全部失败', () => {
        expect(summarizePaperStatus(['ready', 'ready'])).toBe('ready');
        expect(summarizePaperStatus(['ready', 'failed'])).toBe('partial');
        expect(summarizePaperStatus(['failed', 'failed'])).toBe('failed');
    });
});

describe('exam-print', () => {
    it('导出文档包含 KaTeX 样式并转义标题', () => {
        const html = buildExamHtmlDocument('<数学> & 物理', '<div class="exam-sheet">内容</div>');
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain(KATEX_CSS_URL);
        expect(html).toContain('<title>&lt;数学&gt; &amp; 物理</title>');
        expect(html).toContain('<div class="exam-sheet">内容</div>');
    });

    it('KaTeX 样式版本与安装的 katex 一致，避免类名前缀不匹配', async () => {
        const { version } = (await import('katex')).default;
        expect(KATEX_CSS_URL).toContain(`katex@${version}/`);
    });

    it('文件名去掉非法字符', () => {
        expect(examFileName('数学 2026/10/18 测试')).toBe('数学_2026_10_18_测试.html');
        expect(examFileName('')).toBe('exam.html');
    });
});

describe('regionFromPoints', () => {
    it('任意方向拖动都得到正向矩形并限制在图片内', () => {
        expect(regionFromPoints(0.8, 0.9, 0.2, 0.1)).toEqual({ x: 0.2, y: 0.1, width: expect.closeTo(0.6), height: expect.closeTo(0.8) });
        expect(regionFromPoints(-0.5, 0.5, 1.5, 0.6)).toMatchObject({ x: 0, width: 1 });
    });
});
