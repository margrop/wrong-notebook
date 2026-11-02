/**
 * 单题手动留白：沿用已保存的值，改动合并延迟保存，恢复默认立即保存
 */
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSavedAnswerSpaces } from '@/lib/use-saved-answer-spaces';
import type { AnswerSpaceChange } from '@/lib/use-saved-answer-spaces';

type Spaces = ReturnType<typeof useSavedAnswerSpaces>;

const ITEMS = [
    { id: 'a', answerSpacePx: 240 },
    { id: 'b', answerSpacePx: null },
    { id: 'c', answerSpacePx: 9999 }, // 非法旧值按未设置处理
];

let root: Root;
let host: HTMLDivElement;
let spaces: Spaces;
let save: ReturnType<typeof vi.fn<(changes: AnswerSpaceChange[]) => Promise<void>>>;

function Probe({ onRender }: { onRender: (value: Spaces) => void }) {
    const value = useSavedAnswerSpaces(ITEMS, save);
    useEffect(() => onRender(value));
    return null;
}

beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    save = vi.fn<(changes: AnswerSpaceChange[]) => Promise<void>>(() => Promise.resolve());
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<Probe onRender={(value) => { spaces = value; }} />); });
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('useSavedAnswerSpaces', () => {
    it('以已保存的合法值为初值', () => {
        expect(spaces.customSpaces).toEqual({ a: 240 });
    });

    it('连续调整立即生效，停顿后合并为一次保存', async () => {
        await act(async () => { spaces.setSpace('b', 100); });
        await act(async () => { spaces.setSpace('b', 120); });
        await act(async () => { spaces.setSpace('a', 260); });
        expect(spaces.customSpaces).toEqual({ a: 260, b: 120 });
        expect(save).not.toHaveBeenCalled();

        await act(async () => { vi.advanceTimersByTime(600); });
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith([{ id: 'b', answerSpacePx: 120 }, { id: 'a', answerSpacePx: 260 }]);
    });

    it('恢复默认与全部重置立即保存', async () => {
        await act(async () => { spaces.setSpace('a', null); });
        expect(spaces.customSpaces).toEqual({});
        expect(save).toHaveBeenLastCalledWith([{ id: 'a', answerSpacePx: null }]);

        await act(async () => { spaces.setSpace('b', 80); });
        await act(async () => { spaces.resetAll(); });
        expect(spaces.customSpaces).toEqual({});
        expect(save).toHaveBeenLastCalledWith([{ id: 'b', answerSpacePx: null }]);
    });

    it('卸载时保存尚未发出的改动', async () => {
        await act(async () => { spaces.setSpace('b', 200); });
        act(() => root.unmount());
        expect(save).toHaveBeenCalledWith([{ id: 'b', answerSpacePx: 200 }]);
        root = createRoot(host);
    });

    it('保存失败时给出提示', async () => {
        save.mockRejectedValueOnce(new Error('offline'));
        await act(async () => { spaces.setSpace('a', null); });
        expect(spaces.saveFailed).toBe(true);
    });
});
