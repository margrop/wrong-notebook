/**
 * 渲染错误兜底页面：展示文案、上报匿名错误、点击重试调用 reset
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { translations } from '@/lib/translations';

const mocks = vi.hoisted(() => ({ trackError: vi.fn() }));
vi.mock('@/lib/telemetry/client', () => ({ trackError: mocks.trackError }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn() } }));

import ErrorPage from '@/app/error';
import GlobalError from '@/app/global-error';

let container: HTMLDivElement;

afterEach(() => {
    container?.remove();
    mocks.trackError.mockClear();
});

function mount(node: React.ReactNode) {
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(node));
    return root;
}

describe('错误兜底页面', () => {
    it('路由段错误：显示文案、上报 boundary 错误，重试调用 reset', () => {
        const reset = vi.fn();
        const error = new Error('render failed');
        mount(<LanguageProvider><ErrorPage error={error} reset={reset} /></LanguageProvider>);
        expect(container.textContent).toContain(translations.zh.errorBoundary.title);
        expect(mocks.trackError).toHaveBeenCalledWith({ kind: 'boundary', scope: 'app.boundary', error });
        act(() => container.querySelector('button')!.click());
        expect(reset).toHaveBeenCalled();
    });

    it('根布局错误：上报 app.global，中英文文案静态内联', async () => {
        const { renderToStaticMarkup } = await import('react-dom/server');
        const markup = renderToStaticMarkup(<GlobalError error={new Error('x')} reset={() => undefined} />);
        expect(markup).toContain('Something went wrong');
        expect(markup).toContain('页面出错了');
    });
});
