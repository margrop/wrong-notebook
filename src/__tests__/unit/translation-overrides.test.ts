import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/en';
import { TRANSLATION_OVERRIDES } from '@/lib/i18n/overrides';
import { zh } from '@/lib/i18n/zh';
import { deepMerge, translations } from '@/lib/translations';

describe('deepMerge', () => {
    it('覆盖嵌套对象的叶子节点', () => {
        const base = { a: { b: { c: 1, d: 2 } } };
        const override = { a: { b: { c: 10 } } };
        expect(deepMerge(base, override)).toEqual({ a: { b: { c: 10, d: 2 } } });
    });

    it('数组整体替换而不是逐项合并', () => {
        const base = { list: [1, 2, 3] };
        const override = { list: [9] };
        expect(deepMerge(base, override)).toEqual({ list: [9] });
    });

    it('函数整体替换', () => {
        const fnBase = () => 'base';
        const fnOverride = () => 'override';
        expect(deepMerge({ fn: fnBase }, { fn: fnOverride }).fn).toBe(fnOverride);
    });

    it('不修改任何入参', () => {
        const base = { a: { b: 1 }, list: [1, 2] };
        const override = { a: { b: 10 }, list: [3] };
        deepMerge(base, override);
        expect(base).toEqual({ a: { b: 1 }, list: [1, 2] });
        expect(override).toEqual({ a: { b: 10 }, list: [3] });
    });

    it('override 为 undefined 时返回 base', () => {
        const base = { a: 1 };
        // 模拟 applyOverrides 的传参路径
        expect(deepMerge(base, undefined as unknown as typeof base)).toBeUndefined();
    });
});

describe('translations 覆盖合并', () => {
    it('上游覆盖为空对象时，translations 与 en/zh 原对象深相等', () => {
        expect(TRANSLATION_OVERRIDES).toEqual({});
        expect(translations.en).toEqual(en);
        expect(translations.zh).toEqual(zh);
    });
});
