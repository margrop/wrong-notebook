import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportFileButton } from '@/components/import-file-button';
import { IMPORT_FILE_TYPES } from '@/lib/import/file-read';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { toast } from '@/lib/feedback';

vi.mock('@/lib/feedback', () => ({ toast: { error: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
});

const render = (onFile: (file: File) => void) => act(async () => root.render(
    <LanguageProvider><ImportFileButton types={IMPORT_FILE_TYPES} onFile={onFile} /></LanguageProvider>
));

function pickFile(file: File) {
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
}

describe('ImportFileButton', () => {
    it('渲染按钮与隐藏文件输入框', async () => {
        await render(() => undefined);
        expect(container.querySelector('button')?.textContent).toContain('从文件导入');
        expect(container.querySelector('input[type=file]')).not.toBeNull();
    });

    it('选择 TXT 文件时回调 onFile', async () => {
        const onFile = vi.fn();
        await render(onFile);
        const file = new File(['abc'], 'note.txt', { type: 'text/plain' });
        await act(async () => pickFile(file));
        expect(onFile).toHaveBeenCalledWith(file, expect.objectContaining({ key: 'text' }));
    });

    it('不支持的类型提示错误且不回调', async () => {
        const onFile = vi.fn();
        await render(onFile);
        await act(async () => pickFile(new File(['x'], 'image.png', { type: 'image/png' })));
        expect(toast.error).toHaveBeenCalled();
        expect(onFile).not.toHaveBeenCalled();
    });

    it('超过体积上限提示错误且不回调', async () => {
        const onFile = vi.fn();
        await render(onFile);
        const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.txt', { type: 'text/plain' });
        await act(async () => pickFile(big));
        expect(toast.error).toHaveBeenCalled();
        expect(onFile).not.toHaveBeenCalled();
    });
});
