import { describe, expect, it } from 'vitest';
import { buildErrorListParams, parseErrorListSearchParams } from '@/lib/error-list/error-list-filters';
import { getItemTags } from '@/lib/tags/item-tags';

const empty = { search: '', mastery: 'all', timeRange: 'all', tag: null, gradeSemester: '', chapter: '', paperLevel: 'all' } as const;

describe('错题列表筛选参数', () => {
    it('未筛选时不带任何参数', () => {
        expect(buildErrorListParams(empty).toString()).toBe('');
    });

    it('各筛选条件转成对应参数名', () => {
        const params = buildErrorListParams({
            subjectId: 'nb', search: '方程', mastery: 'reviewing', timeRange: 'week', tag: '勾股定理', gradeSemester: '初二上', chapter: '第一章', paperLevel: 'b',
        });
        expect(Object.fromEntries(params)).toEqual({
            subjectId: 'nb', query: '方程', mastery: 'reviewing', timeRange: 'week', tag: '勾股定理', gradeSemester: '初二上', chapter: '第一章', paperLevel: 'b',
        });
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
