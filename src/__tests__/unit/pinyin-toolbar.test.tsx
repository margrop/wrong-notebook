import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PinyinToolbar } from '@/components/pinyin-toolbar';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { translations } from '@/lib/translations';

let container: HTMLDivElement;
let root: Root;
const zh = translations.zh.pinyinToolbar;

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

function Harness({ initial, subject }: { initial: string; subject?: string }) {
    const [value, setValue] = useState(initial);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    return (
        <>
            <textarea ref={textareaRef} value={value} onChange={(event) => setValue(event.target.value)} />
            <PinyinToolbar value={value} onChange={setValue} textareaRef={textareaRef} subject={subject} />
        </>
    );
}

const buttonByText = (text: string) => [...container.querySelectorAll('button')].find((button) => button.textContent === text) as HTMLButtonElement | undefined;

describe('PinyinToolbar', () => {
    it('语文默认展开，其他学科默认收起，可手动展开', async () => {
        await act(async () => root.render(<LanguageProvider><Harness initial="" subject="语文" /></LanguageProvider>));
        expect(buttonByText('ā')).not.toBeUndefined();
        expect(buttonByText(zh.convert)).not.toBeUndefined();

        await act(async () => root.render(<LanguageProvider><Harness key="math" initial="" subject="数学" /></LanguageProvider>));
        expect(buttonByText('ā')).toBeUndefined();
        await act(async () => buttonByText(zh.title)?.click());
        expect(buttonByText('ā')).not.toBeUndefined();
    });

    it('点击带调元音在光标处插入，并把光标移到插入内容之后', async () => {
        await act(async () => root.render(<LanguageProvider><Harness initial="看拼音写词语" subject="语文" /></LanguageProvider>));
        const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
        textarea.focus();
        textarea.setSelectionRange(1, 1);
        expect(buttonByText('ā')).not.toBeUndefined();
        await act(async () => buttonByText('ā')?.click());

        await act(async () => {
            const { promise, resolve } = Promise.withResolvers<void>();
            requestAnimationFrame(() => resolve());
            await promise;
        });

        expect(textarea.value).toBe('看ā拼音写词语');
        expect(textarea.selectionStart).toBe(2);
        expect(textarea.selectionEnd).toBe(2);
    });

    it('数字转声调按钮转换当前题干中的数字声调', async () => {
        await act(async () => root.render(<LanguageProvider><Harness initial="看拼音写词语：ma3，lv4" subject="语文" /></LanguageProvider>));
        await act(async () => buttonByText(zh.convert)?.click());
        expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('看拼音写词语：mǎ，lǜ');
    });
});
