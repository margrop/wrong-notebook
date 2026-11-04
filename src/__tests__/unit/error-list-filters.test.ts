import { describe, expect, it } from 'vitest';
import { buildErrorListParams, parseErrorListSearchParams, parseQuestionTypeFilter } from '@/lib/error-list/error-list-filters';
import type { ErrorListFilters } from '@/lib/error-list/error-list-filters';
import { getItemTags } from '@/lib/tags/item-tags';

const empty: ErrorListFilters = { search: '', mastery: 'all', timeRange: 'all', tag: null, gradeSemester: '', chapter: '', paperLevel: 'all', questionTypes: [] };

describe('错题列表筛选参数', () => {
    it('未筛选时不带任何参数', () => {
        expect(buildErrorListParams(empty).toString()).toBe('');
    });

    it('各筛选条件转成对应参数名', () => {
        const params = buildErrorListParams({
            subjectId: 'nb', search: '方程', mastery: 'reviewing', timeRange: 'week', tag: '勾股定理', gradeSemester: '初二上', chapter: '第一章', paperLevel: 'b',
            questionTypes: ['single_choice', 'none'],
        });
        expect(Object.fromEntries(params)).toEqual({
            subjectId: 'nb', query: '方程', mastery: 'reviewing', timeRange: 'week', tag: '勾股定理', gradeSemester: '初二上', chapter: '第一章', paperLevel: 'b',
            questionTypes: 'single_choice,none',
        });
    });

    it('题型为空数组时不带参数', () => {
        expect(buildErrorListParams(empty).toString()).toBe('');
    });
});

describe('parseQuestionTypeFilter', () => {
    it('空值返回空数组', () => {
        expect(parseQuestionTypeFilter(null)).toEqual([]);
        expect(parseQuestionTypeFilter('')).toEqual([]);
    });

    it('解析单个与多个合法题型', () => {
        expect(parseQuestionTypeFilter('single_choice')).toEqual(['single_choice']);
        expect(parseQuestionTypeFilter('single_choice,multiple_choice')).toEqual(['single_choice', 'multiple_choice']);
    });

    it('接受 none 表示未设置题型', () => {
        expect(parseQuestionTypeFilter('none')).toEqual(['none']);
        expect(parseQuestionTypeFilter('single_choice,none')).toEqual(['single_choice', 'none']);
    });

    it('非法值被忽略而不是报错', () => {
        expect(parseQuestionTypeFilter('unknown')).toEqual([]);
        expect(parseQuestionTypeFilter('single_choice,unknown,none')).toEqual(['single_choice', 'none']);
    });

    it('重复值去重', () => {
        expect(parseQuestionTypeFilter('single_choice,single_choice')).toEqual(['single_choice']);
    });
});

describe('从地址参数解析错题列表初始筛选', () => {
    it('空参数返回空筛选', () => {
        expect(parseErrorListSearchParams(new URLSearchParams())).toEqual({});
    });

    it('合法的 mastery 状态被解析', () => {
        expect(parseErrorListSearchParams(new URLSearchParams('mastery=new'))).toEqual({ mastery: 'new' });
        expect(parseErrorListSearchParams(new URLSearchParams('mastery=reviewing'))).toEqual({ mastery: 'reviewing' });
        expect(parseErrorListSearchParams(new URLSearchParams('mastery=mastered'))).toEqual({ mastery: 'mastered' });
    });

    it('非法的 mastery 值被忽略', () => {
        expect(parseErrorListSearchParams(new URLSearchParams('mastery=all'))).toEqual({});
        expect(parseErrorListSearchParams(new URLSearchParams('mastery=unknown'))).toEqual({});
    });

    it('tag 参数被解析', () => {
        expect(parseErrorListSearchParams(new URLSearchParams('tag=勾股定理'))).toEqual({ tag: '勾股定理' });
    });

    it('同时存在 mastery 与 tag 时全部解析', () => {
        expect(parseErrorListSearchParams(new URLSearchParams('mastery=mastered&tag=二次函数'))).toEqual({ mastery: 'mastered', tag: '二次函数' });
    });
});

describe('题目知识点', () => {
    it('优先使用标签关联', () => {
        expect(getItemTags({ tags: [{ name: 'A' }], knowledgePoints: '["B"]' })).toEqual(['A']);
    });

    it('没有标签关联时读取旧字段，格式错误时返回空', () => {
        expect(getItemTags({ tags: [], knowledgePoints: '["B", 1]' })).toEqual(['B']);
        expect(getItemTags({ knowledgePoints: 'not json' })).toEqual([]);
        expect(getItemTags({})).toEqual([]);
    });
});
