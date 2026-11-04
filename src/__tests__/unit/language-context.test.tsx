import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, loadEnTranslations, useLanguage } from '@/contexts/LanguageContext';
import { zh } from '@/lib/i18n/zh';
import { localStorageMock } from '../setup';

// 计数 en 模块被加载的次数：zh 用户不应触发；en 用户最多触发一次（模块级缓存）。
// 加载被闸门挡住，由测试决定何时完成，才能稳定断言「加载完成前先显示中文」的中间状态。
const enGate = vi.hoisted(() => {
    let release: () => void = () => {};
    const opened = new Promise<void>((resolve) => { release = resolve; });
    return { opened, release: () => release() };
});
let enLoadCount = 0;
vi.mock('@/lib/i18n/en', async (importOriginal) => {
    enLoadCount += 1;
    await enGate.opened;
    const mod = await importOriginal<typeof import('@/lib/i18n/en')>();
    return mod;
});

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
    vi.unstubAllGlobals();
});

function Probe() {
    const { language, t } = useLanguage();
    return (
        <div>
            <span data-testid="language">{language}</span>
            <span data-testid="text">{t.common.loading}</span>
        </div>
    );
}

describe('LanguageProvider 按需加载英文文案', () => {
    it('语言为 zh 时不加载 en 模块', async () => {
        localStorageMock.setItem('app-language', 'zh');
        const before = enLoadCount;

        await act(async () => root.render(<LanguageProvider><Probe /></LanguageProvider>));

        expect(container.querySelector('[data-testid="language"]')?.textContent).toBe('zh');
        expect(container.querySelector('[data-testid="text"]')?.textContent).toBe(zh.common.loading);
        expect(enLoadCount).toBe(before);
    });

    it('语言为 en 时先返回中文，动态加载完成后切换为英文', async () => {
        localStorageMock.setItem('app-language', 'en');

        await act(async () => root.render(<LanguageProvider><Probe /></LanguageProvider>));

        // 加载完成前先回退到中文
        expect(container.querySelector('[data-testid="language"]')?.textContent).toBe('en');
        expect(container.querySelector('[data-testid="text"]')?.textContent).toBe(zh.common.loading);

        // 放行英文模块并等待动态 import 完成
        enGate.release();
        await act(async () => {
            await loadEnTranslations();
        });

        const { en } = await import('@/lib/i18n/en');
        expect(container.querySelector('[data-testid="text"]')?.textContent).toBe(en.common.loading);
    });

    it('en 模块只动态加载一次（模块级缓存），重复切换不重复加载', async () => {
        enGate.release();
        localStorageMock.setItem('app-language', 'en');

        await act(async () => root.render(<LanguageProvider><Probe /></LanguageProvider>));
        await act(async () => {
            await loadEnTranslations();
        });

        const afterFirstLoad = enLoadCount;

        // 切换回 zh 再切回 en，不应重新加载
        await act(async () => {
            localStorageMock.setItem('app-language', 'zh');
            window.dispatchEvent(new Event('storage'));
        });
        await act(async () => {
            localStorageMock.setItem('app-language', 'en');
            window.dispatchEvent(new Event('storage'));
        });
        await act(async () => {
            await loadEnTranslations();
        });

        const { en } = await import('@/lib/i18n/en');
        expect(container.querySelector('[data-testid="text"]')?.textContent).toBe(en.common.loading);
        expect(enLoadCount).toBe(afterFirstLoad);
    });
});
