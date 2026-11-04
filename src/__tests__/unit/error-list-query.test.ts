import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
    parseErrorListQueryParams,
    buildErrorListWhere,
    buildGradeFilter,
    type ErrorListQueryDeps,
} from '@/lib/error-list/error-list-query';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from '@/lib/constants/pagination';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeDeps(overrides: {
    findFirstResult?: { id: string } | null;
    childrenMap?: Record<string, { id: string }[]>;
} = {}): ErrorListQueryDeps & {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
} {
    const findFirst = vi.fn().mockResolvedValue(overrides.findFirstResult ?? null);
    const findMany = vi.fn().mockImplementation(
        ({ where }: { where: { parentId: string } }) =>
            Promise.resolve(overrides.childrenMap?.[where.parentId] ?? [])
    );
    return { knowledgeTag: { findFirst, findMany }, findFirst, findMany };
}

const baseParams = {
    subjectId: null,
    query: null,
    mastery: null,
    timeRange: 'all' as const,
    tag: null,
    chapter: null,
    gradeSemester: null,
    paperLevel: null,
    view: null,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
};

// ─── parseErrorListQueryParams ──────────────────────────────────────────────

describe('parseErrorListQueryParams', () => {
    it('空参数返回默认值', () => {
        const params = parseErrorListQueryParams(new URLSearchParams());
        expect(params).toEqual({ ...baseParams });
    });

    it('解析所有字符串参数', () => {
        const sp = new URLSearchParams(
            'subjectId=s1&query=方程&mastery=new&timeRange=week&tag=勾股定理&chapter=第一章&gradeSemester=初二上&paperLevel=a&view=print'
        );
        const params = parseErrorListQueryParams(sp);
        expect(params.subjectId).toBe('s1');
        expect(params.query).toBe('方程');
        expect(params.mastery).toBe('new');
        expect(params.timeRange).toBe('week');
        expect(params.tag).toBe('勾股定理');
        expect(params.chapter).toBe('第一章');
        expect(params.gradeSemester).toBe('初二上');
        expect(params.paperLevel).toBe('a');
        expect(params.view).toBe('print');
    });

    it('page/pageSize 默认为 1 / DEFAULT_PAGE_SIZE', () => {
        const params = parseErrorListQueryParams(new URLSearchParams());
        expect(params.page).toBe(1);
        expect(params.pageSize).toBe(DEFAULT_PAGE_SIZE);
    });

    it('page 为 0 或负数时被夹紧到 1', () => {
        expect(parseErrorListQueryParams(new URLSearchParams('page=0')).page).toBe(1);
        expect(parseErrorListQueryParams(new URLSearchParams('page=-5')).page).toBe(1);
    });

    it('page 为非数字字符串时回退到默认值 1', () => {
        expect(parseErrorListQueryParams(new URLSearchParams('page=abc')).page).toBe(1);
    });

    it('pageSize 为非数字字符串时回退到默认值 DEFAULT_PAGE_SIZE', () => {
        expect(parseErrorListQueryParams(new URLSearchParams('pageSize=abc')).pageSize).toBe(DEFAULT_PAGE_SIZE);
    });

    it('pageSize 小于 MIN_PAGE_SIZE 时被夹紧', () => {
        expect(parseErrorListQueryParams(new URLSearchParams('pageSize=0')).pageSize).toBe(MIN_PAGE_SIZE);
        expect(parseErrorListQueryParams(new URLSearchParams('pageSize=-3')).pageSize).toBe(MIN_PAGE_SIZE);
    });

    it('pageSize 大于 MAX_PAGE_SIZE 时被夹紧', () => {
        expect(parseErrorListQueryParams(new URLSearchParams(`pageSize=${MAX_PAGE_SIZE + 1}`)).pageSize).toBe(MAX_PAGE_SIZE);
    });

    it('pageSize 在范围内时保留原值', () => {
        expect(parseErrorListQueryParams(new URLSearchParams('pageSize=50')).pageSize).toBe(50);
    });

    it('非法 mastery 值解析为 null', () => {
        expect(parseErrorListQueryParams(new URLSearchParams('mastery=unknown')).mastery).toBeNull();
        expect(parseErrorListQueryParams(new URLSearchParams('mastery=all')).mastery).toBeNull();
    });

    it('timeRange 只接受 week/month，其他值回退到 all', () => {
        expect(parseErrorListQueryParams(new URLSearchParams('timeRange=week')).timeRange).toBe('week');
        expect(parseErrorListQueryParams(new URLSearchParams('timeRange=month')).timeRange).toBe('month');
        expect(parseErrorListQueryParams(new URLSearchParams('timeRange=invalid')).timeRange).toBe('all');
    });
});

// ─── buildErrorListWhere ────────────────────────────────────────────────────

describe('buildErrorListWhere', () => {
    it('无筛选条件时仅返回 userId', async () => {
        const deps = makeDeps();
        const where = await buildErrorListWhere(baseParams, 'u1', 50, deps);
        expect(where).toEqual({ userId: 'u1' });
    });

    it('按学科筛选', async () => {
        const deps = makeDeps();
        const where = await buildErrorListWhere(
            { ...baseParams, subjectId: 'math' }, 'u1', 50, deps
        );
        expect(where).toEqual({ userId: 'u1', subjectId: 'math' });
    });

    it('按关键字搜索（短 ID 匹配并入 OR）', async () => {
        const deps = makeDeps();
        const where = await buildErrorListWhere(
            { ...baseParams, query: 'aB3xYz' }, 'u1', 50, deps
        );
        const and = (where.AND as Prisma.ErrorItemWhereInput[]);
        expect(and).toHaveLength(1);
        const or = and[0].OR as Prisma.ErrorItemWhereInput[];
        expect(or).toContainEqual({ shortId: 'aB3xYz' });
        expect(or).toContainEqual({ questionText: { contains: 'aB3xYz' } });
    });

    it('普通查询词不包含 shortId 条件', async () => {
        const deps = makeDeps();
        const where = await buildErrorListWhere(
            { ...baseParams, query: '勾股定理' }, 'u1', 50, deps
        );
        const or = (where.AND as Prisma.ErrorItemWhereInput[])[0].OR as Prisma.ErrorItemWhereInput[];
        expect(or.some((c) => 'shortId' in c)).toBe(false);
    });

    it.each([
        ['new', { practiceRecords: { none: { result: { not: null } } } }],
        ['reviewing', {
            practiceRecords: { some: { result: { not: null } } },
            OR: [{ masteryProbability: null }, { masteryProbability: { lt: 0.5 } }],
        }],
        ['mastered', { practiceRecords: { some: { result: { not: null } } }, masteryProbability: { gte: 0.5 } }],
    ] as const)('按复习状态 %s 筛选', async (status, condition) => {
        const deps = makeDeps();
        const where = await buildErrorListWhere(
            { ...baseParams, mastery: status }, 'u1', 50, deps
        );
        expect(where.AND).toEqual([condition]);
    });

    it('按复习状态筛选时使用传入的 masteryThreshold', async () => {
        const deps = makeDeps();
        const where = await buildErrorListWhere(
            { ...baseParams, mastery: 'mastered' }, 'u1', 80, deps
        );
        expect(where.AND).toEqual([
            { practiceRecords: { some: { result: { not: null } } }, masteryProbability: { gte: 0.8 } },
        ]);
    });

    it('timeRange=week 时 createdAt >= 七天前', async () => {
        const deps = makeDeps();
        const before = Date.now();
        const where = await buildErrorListWhere(
            { ...baseParams, timeRange: 'week' }, 'u1', 50, deps
        );
        const gte = (where.createdAt as { gte: Date }).gte;
        expect(gte.getTime()).toBeLessThanOrEqual(before);
        expect(gte.getTime()).toBeGreaterThan(before - 8 * 24 * 60 * 60 * 1000);
    });

    it('timeRange=month 时 createdAt >= 一个月前', async () => {
        const deps = makeDeps();
        const before = Date.now();
        const where = await buildErrorListWhere(
            { ...baseParams, timeRange: 'month' }, 'u1', 50, deps
        );
        const gte = (where.createdAt as { gte: Date }).gte;
        expect(gte.getTime()).toBeLessThanOrEqual(before);
        expect(gte.getTime()).toBeGreaterThan(before - 32 * 24 * 60 * 60 * 1000);
    });

    it('timeRange=all 时不加时间条件', async () => {
        const deps = makeDeps();
        const where = await buildErrorListWhere(baseParams, 'u1', 50, deps);
        expect(where).not.toHaveProperty('createdAt');
    });

    it('chapter 筛选：找到后代标签时用 id in 过滤', async () => {
        const deps = makeDeps({
            findFirstResult: { id: 'tag-root' },
            childrenMap: { 'tag-root': [{ id: 'tag-child' }] },
        });
        const where = await buildErrorListWhere(
            { ...baseParams, chapter: '第一章' }, 'u1', 50, deps
        );
        expect(deps.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ name: '第一章' }) })
        );
        expect(where.tags).toEqual({ some: { id: { in: ['tag-root', 'tag-child'] } } });
    });

    it('chapter 筛选：章节不存在时返回必然为假的条件', async () => {
        const deps = makeDeps({ findFirstResult: null });
        const where = await buildErrorListWhere(
            { ...baseParams, chapter: '不存在' }, 'u1', 50, deps
        );
        expect(where.id).toBe('__IMPOSSIBLE_ID__');
        expect(where).not.toHaveProperty('tags');
    });

    it('chapter 筛选：多级后代全部包含', async () => {
        const deps = makeDeps({
            findFirstResult: { id: 'a' },
            childrenMap: { a: [{ id: 'b' }], b: [{ id: 'c' }] },
        });
        const where = await buildErrorListWhere(
            { ...baseParams, chapter: '章' }, 'u1', 50, deps
        );
        expect(where.tags).toEqual({ some: { id: { in: ['a', 'b', 'c'] } } });
    });

    it('tag 筛选（无 chapter）：标签关系 + 旧 knowledgePoints 字段 OR 匹配', async () => {
        const deps = makeDeps();
        const where = await buildErrorListWhere(
            { ...baseParams, tag: '函数' }, 'u1', 50, deps
        );
        expect(where.AND).toEqual([
            {
                OR: [
                    { tags: { some: { name: '函数' } } },
                    { knowledgePoints: { contains: '"函数"' } },
                ],
            },
        ]);
    });

    it('tag + chapter 同时存在时 tag 覆盖 chapter 的 tags 条件', async () => {
        const deps = makeDeps({
            findFirstResult: { id: 'tag-root' },
        });
        const where = await buildErrorListWhere(
            { ...baseParams, tag: '二次函数', chapter: '第一章' }, 'u1', 50, deps
        );
        expect(where.tags).toEqual({ some: { name: '二次函数' } });
        // tag 不再进入 AND
        expect(where.AND).toBeUndefined();
    });

    it('gradeSemester 筛选并入 whereClause', async () => {
        const deps = makeDeps();
        const where = await buildErrorListWhere(
            { ...baseParams, gradeSemester: '初一上' }, 'u1', 50, deps
        );
        expect(where.OR).toBeDefined();
    });

    it('paperLevel=all 时不加筛选条件', async () => {
        const deps = makeDeps();
        const where = await buildErrorListWhere(
            { ...baseParams, paperLevel: 'all' }, 'u1', 50, deps
        );
        expect(where).not.toHaveProperty('paperLevel');
    });

    it('paperLevel 具体值时加到 whereClause', async () => {
        const deps = makeDeps();
        const where = await buildErrorListWhere(
            { ...baseParams, paperLevel: 'a' }, 'u1', 50, deps
        );
        expect(where.paperLevel).toBe('a');
    });

    it('多个 AND 条件同时存在时合并到 AND 数组', async () => {
        const deps = makeDeps();
        const where = await buildErrorListWhere(
            { ...baseParams, query: '方程', mastery: 'new' }, 'u1', 50, deps
        );
        const and = where.AND as Prisma.ErrorItemWhereInput[];
        expect(and).toHaveLength(2);
        expect(and[0].OR).toBeDefined(); // query
        expect(and[1].practiceRecords).toBeDefined(); // mastery
    });

    it('组合：subjectId + tag + paperLevel + timeRange', async () => {
        const deps = makeDeps();
        const where = await buildErrorListWhere(
            {
                ...baseParams,
                subjectId: 'math',
                tag: '方程',
                paperLevel: 'b',
                timeRange: 'month',
            },
            'u1', 50, deps
        );
        expect(where.subjectId).toBe('math');
        expect(where.paperLevel).toBe('b');
        expect(where.createdAt).toBeDefined();
        expect(where.AND).toBeDefined();
    });
});

// ─── buildGradeFilter ──────────────────────────────────────────────────────

describe('buildGradeFilter', () => {
    it('完全无法解析时按原字符串模糊匹配', () => {
        expect(buildGradeFilter('xyz')).toEqual({ gradeSemester: { contains: 'xyz' } });
    });

    it('识别标准年级 + 上学期（含别名）', () => {
        const result = buildGradeFilter('初一上') as { OR: Prisma.ErrorItemWhereInput[] };
        expect(result.OR).toContainEqual({ gradeSemester: { contains: '初一上' } });
        expect(result.OR).toContainEqual({ gradeSemester: { contains: '初一，上' } });
        expect(result.OR).toContainEqual({ gradeSemester: { contains: '初一,上' } });
        expect(result.OR).toContainEqual({ gradeSemester: { contains: '初一 上' } });
        expect(result.OR).toContainEqual({ gradeSemester: { contains: '初一，上期' } });
        // 别名也应出现
        expect(result.OR).toContainEqual({ gradeSemester: { contains: '七年级上' } });
    });

    it('识别标准年级 + 下学期', () => {
        const result = buildGradeFilter('初二下') as { OR: Prisma.ErrorItemWhereInput[] };
        expect(result.OR).toContainEqual({ gradeSemester: { contains: '初二，下期' } });
    });

    it('只指定年级不带学期', () => {
        const result = buildGradeFilter('高一') as { OR: Prisma.ErrorItemWhereInput[] };
        expect(result.OR).toContainEqual({ gradeSemester: { contains: '高一' } });
        expect(result.OR).toContainEqual({ gradeSemester: { contains: '10年级' } });
    });

    it('无法识别的年级前缀按前缀匹配', () => {
        const result = buildGradeFilter('一年级上');
        expect(result).toEqual({ OR: expect.arrayContaining([
            { gradeSemester: { contains: '一年级上' } },
        ]) });
    });
});
