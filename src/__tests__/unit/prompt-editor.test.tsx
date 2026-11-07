/**
 * 提示词编辑器：复制、用剪贴板整体替换、恢复默认，以及缺少变量的提示
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptEditor } from '@/components/settings/prompt-editor';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { copyText, readClipboardText } from '@/lib/clipboard';
import { confirmDialog, toast } from '@/lib/feedback';

vi.mock('@/lib/clipboard', () => ({ copyText: vi.fn(), readClipboardText: vi.fn() }));
vi.mock('@/lib/feedback', () => ({
    confirmDialog: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const DEFAULT_TEMPLATE = '默认模板 {{question_text}} {{subject_hint}}';
const VARIABLES = [
    { name: 'question_text', description: '题目文本' },
    { name: 'subject_hint', description: '学科' },
];

let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();
const onReset = vi.fn();

function findButton(text: string): HTMLButtonElement | undefined {
    return [...document.querySelectorAll('button')].find((button) => button.textContent?.includes(text));
}

async function render(value = '默认模板 {{question_text}} {{subject_hint}}') {
    await act(async () => root.render(
        <LanguageProvider>
            <PromptEditor
                value={value}
                defaultValue={DEFAULT_TEMPLATE}
                onChange={onChange}
                onReset={onReset}
                title="自定义解题提示词模板"
                variables={VARIABLES}
            />
        </LanguageProvider>,
    ));
}

beforeEach(() => {
    vi.clearAllMocks();
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

describe('提示词编辑器', () => {
    it('复制当前模板并提示成功', async () => {
        vi.mocked(copyText).mockResolvedValue(true);
        await render();

        await act(async () => findButton('复制')!.click());

        expect(copyText).toHaveBeenCalledWith('默认模板 {{question_text}} {{subject_hint}}', expect.any(Function));
        expect(toast.success).toHaveBeenCalled();
    });

    it('复制失败时不提示成功', async () => {
        vi.mocked(copyText).mockResolvedValue(false);
        await render();

        await act(async () => findButton('复制')!.click());

        expect(toast.success).not.toHaveBeenCalled();
    });

    it('确认后用剪贴板内容整体替换模板', async () => {
        vi.mocked(readClipboardText).mockResolvedValue('我的定制提示词 {{question_text}}');
        vi.mocked(confirmDialog).mockResolvedValue(true);
        await render();

        await act(async () => findButton('用剪贴板替换')!.click());

        expect(onChange).toHaveBeenCalledWith('我的定制提示词 {{question_text}}');
        expect(toast.success).toHaveBeenCalled();
    });

    it('用户取消时不替换', async () => {
        vi.mocked(readClipboardText).mockResolvedValue('取消的内容');
        vi.mocked(confirmDialog).mockResolvedValue(false);
        await render();

        await act(async () => findButton('用剪贴板替换')!.click());

        expect(onChange).not.toHaveBeenCalled();
    });

    it('剪贴板不可读或为空时提示失败且不替换', async () => {
        vi.mocked(readClipboardText).mockResolvedValue(null);
        await render();

        await act(async () => findButton('用剪贴板替换')!.click());
        expect(toast.error).toHaveBeenCalledTimes(1);

        vi.mocked(readClipboardText).mockResolvedValue('   ');
        await act(async () => findButton('用剪贴板替换')!.click());
        expect(toast.error).toHaveBeenCalledTimes(2);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('确认后恢复默认模板', async () => {
        vi.mocked(confirmDialog).mockResolvedValue(true);
        await render();

        await act(async () => findButton('恢复默认')!.click());

        expect(onReset).toHaveBeenCalled();
    });

    it('模板缺少变量时提示缺少的名称', async () => {
        await render('只使用 {{question_text}}');

        expect(document.body.textContent).toContain('当前模板未使用');
        expect(document.body.textContent).toContain('{{subject_hint}}');
        expect(document.body.textContent).not.toContain('{{question_text}}。');
    });
});