/**
 * 记住上次选择：录入方式、裁剪模式等保存在本机浏览器，不合法的值回退默认；
 * 服务端渲染输出默认值，避免水合不一致；组卷偏好逐项校验
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStoredChoice } from '@/lib/hooks/use-stored-choice';
import { DEFAULT_EXAM_FORM_PREFERENCES, parseExamFormPreferences, serializeExamFormPreferences } from '@/lib/exam/exam-form-preferences';
import { HOME_INPUT_MODES, INPUT_MODE_STORAGE_KEY, NOTEBOOK_INPUT_MODES } from '@/lib/ui-preferences';

function Probe({ options, next = 'text' }: { options: readonly string[]; next?: string }) {
    const [value, set] = useStoredChoice(INPUT_MODE_STORAGE_KEY, options, 'image');
    return <button type="button" onClick={() => set(next)}>{value}</button>;
}

const choose = (container: HTMLElement) => act(() => container.querySelector('button')?.click());

describe('useStoredChoice', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        localStorage.clear();
        container = document.createElement('div');
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        vi.unstubAllGlobals();
    });

    it('没有保存时用默认值，选择后写入本机并更新', () => {
        act(() => root.render(<Probe options={HOME_INPUT_MODES} />));
        expect(container.textContent).toBe('image');
        choose(container);
        expect(container.textContent).toBe('text');
        expect(localStorage.getItem(INPUT_MODE_STORAGE_KEY)).toBe('text');
    });

    it('重新打开时读取上次的选择', () => {
        localStorage.setItem(INPUT_MODE_STORAGE_KEY, 'file');
        act(() => root.render(<Probe options={HOME_INPUT_MODES} />));
        expect(container.textContent).toBe('file');
    });

    it('保存的值不在当前可选范围时回退默认，且不覆盖保存的值', () => {
        localStorage.setItem(INPUT_MODE_STORAGE_KEY, 'file');
        act(() => root.render(<Probe options={NOTEBOOK_INPUT_MODES} />));
        expect(container.textContent).toBe('image');
        expect(localStorage.getItem(INPUT_MODE_STORAGE_KEY)).toBe('file');
    });

    it('无法写入本机存储时只在本次生效', () => {
        act(() => root.render(<Probe options={HOME_INPUT_MODES} next="direct" />));
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        choose(container);
        expect(container.textContent).toBe('direct');
        setItem.mockRestore();
    });

    it('服务端渲染输出默认值', () => {
        localStorage.setItem(INPUT_MODE_STORAGE_KEY, 'text');
        expect(renderToString(<Probe options={HOME_INPUT_MODES} />)).toContain('image');
    });
});

describe('parseExamFormPreferences', () => {
    it('没有保存或内容损坏时用默认值', () => {
        expect(parseExamFormPreferences(null)).toEqual(DEFAULT_EXAM_FORM_PREFERENCES);
        expect(parseExamFormPreferences('{oops')).toEqual(DEFAULT_EXAM_FORM_PREFERENCES);
        expect(parseExamFormPreferences('"text"')).toEqual(DEFAULT_EXAM_FORM_PREFERENCES);
    });

    it('保存后能完整还原', () => {
        const preferences = { mode: 'original', scope: 'all', pickRule: 'random', count: 25, difficulty: 'harder' } as const;
        expect(parseExamFormPreferences(serializeExamFormPreferences(preferences))).toEqual(preferences);
    });

    it('不合法的字段逐项回退，题数限制在 1–50', () => {
        const parsed = parseExamFormPreferences(JSON.stringify({ mode: 'magic', scope: 'mastered', count: 999, difficulty: 3 }));
        expect(parsed).toEqual({ ...DEFAULT_EXAM_FORM_PREFERENCES, scope: 'mastered', count: 50 });
        expect(parseExamFormPreferences(JSON.stringify({ count: -3 })).count).toBe(1);
        expect(parseExamFormPreferences(JSON.stringify({ count: 'NaN' })).count).toBe(DEFAULT_EXAM_FORM_PREFERENCES.count);
    });
});
