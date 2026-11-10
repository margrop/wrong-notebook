/**
 * 按错题本学段 + 学科获取候选知识点
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const findMany = vi.hoisted(() => vi.fn());
vi.mock('@/lib/prisma', () => ({ prisma: { knowledgeTag: { findMany } } }));
vi.mock('@/lib/logger', () => ({ createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })) }));

import { getNotebookCandidateTags, getScopeTagsFromDB, prefetchSubjectTags } from '@/lib/ai/tag-service';

// 年级 → 章节 → 知识点；小学两个年级、初中一个年级
const tree = [
    { id: 'g1', name: '一年级', parentId: null },
    { id: 'c1', name: '数一数', parentId: 'g1' },
    { id: 't1', name: '10以内数的认识', parentId: 'c1' },
    { id: 't2', name: '比大小', parentId: 'c1' },
    { id: 'g4', name: '四年级', parentId: null },
    { id: 'c4', name: '课外拓展（高思）', parentId: 'g4' },
    { id: 's4', name: '高思上册', parentId: 'c4' },
    { id: 't3', name: '鸡兔同笼', parentId: 's4' },
    { id: 't4', name: '比大小', parentId: 'c4' }, // 与一年级同名，去重
    { id: 'g7', name: '七年级上', parentId: null },
    { id: 'c7', name: '有理数', parentId: 'g7' },
    { id: 't7', name: '正数和负数', parentId: 'c7' },
];

describe('getScopeTagsFromDB', () => {
    beforeEach(() => {
        findMany.mockReset();
        findMany.mockResolvedValue(tree);
    });

    it('返回该学段所有年级下的全部叶子知识点（不按学生年级裁剪），同名去重', async () => {
        expect(await getScopeTagsFromDB('math', 'primary')).toEqual(['10以内数的认识', '比大小', '鸡兔同笼']);
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { subject: 'math', isSystem: true, tagSet: 'default' } }));
    });

    it('其他学段的知识点不会混入', async () => {
        expect(await getScopeTagsFromDB('math', 'junior_high')).toEqual(['正数和负数']);
        expect(await getScopeTagsFromDB('math', 'senior_high')).toEqual([]);
    });

    it('学科未知时不提供候选知识点；否则带上中文学科名', async () => {
        expect(await getNotebookCandidateTags({ stage: 'primary', subject: null })).toBeUndefined();
        expect(await getNotebookCandidateTags({ stage: 'junior_high', subject: 'math' })).toEqual({ subjectName: '数学', tags: ['正数和负数'] });
    });

    it('数据库出错时返回空列表', async () => {
        findMany.mockRejectedValue(new Error('db down'));
        expect(await getScopeTagsFromDB('math', 'primary')).toEqual([]);
    });
});

describe('prefetchSubjectTags', () => {
    beforeEach(() => {
        findMany.mockReset();
        findMany.mockResolvedValue(tree);
    });

    it('未指定学科时预取全部学科标签，语文不再缺省为空', async () => {
        const tags = await prefetchSubjectTags(null, 5);
        expect(Object.keys(tags).sort()).toEqual([
            'prefetchedBiologyTags', 'prefetchedChemistryTags', 'prefetchedChineseTags',
            'prefetchedEnglishTags', 'prefetchedGeographyTags', 'prefetchedHistoryTags',
            'prefetchedMathTags', 'prefetchedPhysicsTags', 'prefetchedPoliticsTags',
            'prefetchedScienceTags',
        ]);
        // 数据库查询由 Prisma 过滤学科与叶子节点，mock 只验证预取键已包含语文
        expect(tags.prefetchedChineseTags).toContain('10以内数的认识');
    });

    it('指定学科时只预取该学科标签', async () => {
        const tags = await prefetchSubjectTags('语文', 5);
        expect(tags.prefetchedChineseTags.length).toBeGreaterThan(0);
        expect(tags.prefetchedMathTags).toEqual([]);
        expect(tags.prefetchedEnglishTags).toEqual([]);
    });

    it('指定科学时只预取科学标签', async () => {
        const tags = await prefetchSubjectTags('科学', 5);
        expect(tags.prefetchedScienceTags.length).toBeGreaterThan(0);
        expect(tags.prefetchedMathTags).toEqual([]);
    });
});
