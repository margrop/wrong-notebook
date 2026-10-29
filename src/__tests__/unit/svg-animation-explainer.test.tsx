/**
 * SVG 动画讲解组件：按界面语言生成、删除和提示动画
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SvgAnimationExplainer } from '@/components/svg-animation-explainer';
import { LanguageProvider } from '@/contexts/LanguageContext';

const mocks = vi.hoisted(() => ({
    post: vi.fn(),
    delete: vi.fn(),
    confirmDialog: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({ apiClient: { post: mocks.post, delete: mocks.delete } }));
vi.mock('@/lib/feedback', () => ({ toast: { error: vi.fn(), success: vi.fn() }, confirmDialog: mocks.confirmDialog }));
vi.mock('@/components/svg-animation-player', () => ({ SvgAnimationPlayer: ({ svg }: { svg: string }) => <div data-testid="player">{svg}</div> }));

const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
let root: Root;
let container: HTMLDivElement;

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
    localStorage.clear();
    vi.unstubAllGlobals();
});

async function render(props: { svgAnimation?: string | null; hasOtherLanguage?: boolean; onChange?: () => void }) {
    await act(async () => root.render(
        <LanguageProvider>
            <SvgAnimationExplainer errorItemId="e1" svgAnimation={props.svgAnimation} hasOtherLanguage={props.hasOtherLanguage} onChange={props.onChange ?? vi.fn()} />
        </LanguageProvider>,
    ));
}

const clickButton = (text: string) => act(async () => {
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
    if (!button) throw new Error(`找不到按钮：${text}`);
    button.click();
});

describe('SVG 动画讲解按界面语言生成', () => {
    it('中文界面生成中文版动画', async () => {
        mocks.post.mockResolvedValue({ svgAnimation: svg });
        const onChange = vi.fn();
        await render({ onChange });

        await clickButton('生成动画讲解');

        expect(mocks.post).toHaveBeenCalledWith('/api/error-items/e1/svg-animation', { language: 'zh' }, expect.objectContaining({ recoverable: true }));
        expect(onChange).toHaveBeenCalledWith('zh', svg);
    });

    it('英文界面生成英文版动画', async () => {
        localStorage.setItem('app-language', 'en');
        mocks.post.mockResolvedValue({ svgAnimation: svg });
        const onChange = vi.fn();
        await render({ onChange });

        await clickButton('Generate animation');

        expect(mocks.post).toHaveBeenCalledWith('/api/error-items/e1/svg-animation', { language: 'en' }, expect.anything());
        expect(onChange).toHaveBeenCalledWith('en', svg);
    });

    it('英文界面只删除英文版动画', async () => {
        localStorage.setItem('app-language', 'en');
        mocks.confirmDialog.mockResolvedValue(true);
        mocks.delete.mockResolvedValue({ success: true });
        const onChange = vi.fn();
        await render({ svgAnimation: svg, onChange });

        await clickButton('Delete');

        expect(mocks.delete).toHaveBeenCalledWith('/api/error-items/e1/svg-animation?language=en');
        expect(onChange).toHaveBeenCalledWith('en', null);
    });

    it('当前语言未生成但另一语言已有动画时提示切换语言查看', async () => {
        await render({ hasOtherLanguage: true });
        expect(container.textContent).toContain('已有英文版动画讲解');
    });

    it('已有动画可补充讲解稿，已有讲解稿时显示重写', async () => {
        const narrated = '<svg xmlns="http://www.w3.org/2000/svg"><metadata id="narration">[{"begin":0,"text":"讲解"}]</metadata></svg>';
        mocks.post.mockResolvedValue({ svgAnimation: narrated });
        const onChange = vi.fn();
        await render({ svgAnimation: svg, onChange });

        await clickButton('补充讲解稿');

        expect(mocks.post).toHaveBeenCalledWith('/api/error-items/e1/svg-animation/narration', { language: 'zh' }, expect.objectContaining({ recoverable: true }));
        expect(onChange).toHaveBeenCalledWith('zh', narrated);

        await render({ svgAnimation: narrated, onChange });
        expect(container.textContent).toContain('重写讲解稿');
    });

    it('补充讲解稿失败时显示原因', async () => {
        mocks.post.mockRejectedValue({ data: { message: 'NO_VALID_NARRATION' } });
        await render({ svgAnimation: svg });

        await clickButton('补充讲解稿');

        expect(container.textContent).toContain('AI 未返回有效的讲解稿');
    });
});
