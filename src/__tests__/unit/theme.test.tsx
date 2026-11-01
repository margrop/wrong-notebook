/**
 * 界面主题：默认跟随系统，可手动切换浅色/深色；偏好缓存在本地并保存到账号
 */
import fs from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    session: { status: 'unauthenticated', data: null as null | { user: { email: string } } },
    get: vi.fn(),
    patch: vi.fn(),
}));

vi.mock('next-auth/react', () => ({ useSession: () => mocks.session }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: mocks.get, patch: mocks.patch } }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { warn: vi.fn(), error: vi.fn() } }));

import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { isThemePreference, resolveTheme, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from '@/lib/theme';
import type { ThemePreference } from '@/lib/theme';

/** 可控的系统深色设置，change 时通知订阅者 */
let systemDark = false;
const mediaListeners = new Set<() => void>();

function setSystemDark(value: boolean) {
    systemDark = value;
    mediaListeners.forEach((listener) => listener());
}

let root: Root;
let host: HTMLDivElement;

const OPTIONS: ThemePreference[] = ['system', 'light', 'dark'];

/** 显示当前主题，并为每种偏好提供一个切换按钮 */
function Probe() {
    const theme = useTheme();
    return (
        <>
            <span data-preference={theme.preference} data-theme={theme.theme} />
            {OPTIONS.map((option) => (
                <button key={option} data-option={option} onClick={() => theme.setPreference(option)} />
            ))}
        </>
    );
}

function setPreference(option: ThemePreference) {
    host.querySelector<HTMLButtonElement>(`button[data-option="${option}"]`)!.click();
}

const probe = () => host.querySelector('span')!;
const htmlIsDark = () => document.documentElement.classList.contains('dark');

async function render() {
    await act(async () => {
        root.render(<ThemeProvider><Probe /></ThemeProvider>);
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    systemDark = false;
    mediaListeners.clear();
    vi.stubGlobal('matchMedia', (query: string) => ({
        get matches() { return query.includes('dark') && systemDark; },
        addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
    }));
    mocks.session = { status: 'unauthenticated', data: null };
    mocks.get.mockResolvedValue({});
    mocks.patch.mockResolvedValue({});
    document.documentElement.classList.remove('dark');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
});

describe('主题工具函数', () => {
    it('只接受 system / light / dark', () => {
        expect(['system', 'light', 'dark'].every(isThemePreference)).toBe(true);
        expect(isThemePreference('purple')).toBe(false);
        expect(isThemePreference(null)).toBe(false);
    });

    it('跟随系统时按系统设置，手动选择时忽略系统设置', () => {
        expect(resolveTheme('system', true)).toBe('dark');
        expect(resolveTheme('system', false)).toBe('light');
        expect(resolveTheme('light', true)).toBe('light');
        expect(resolveTheme('dark', false)).toBe('dark');
    });

    it('本地缓存中的代码片段不会作为首屏脚本执行', () => {
        const injected = vi.fn();
        vi.stubGlobal('themeInitAttack', injected);
        localStorage.setItem(THEME_STORAGE_KEY, 'dark");themeInitAttack();//</script><script>themeInitAttack()</script>');
        systemDark = true;
        new Function(THEME_INIT_SCRIPT)();
        expect(injected).not.toHaveBeenCalled();
        expect(htmlIsDark()).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe('dark');
    });

    it('首屏脚本按本地缓存的偏好设置 dark 类，没有缓存时跟随系统', () => {
        const run = () => new Function(THEME_INIT_SCRIPT)();

        systemDark = true;
        run();
        expect(htmlIsDark()).toBe(true);

        localStorage.setItem(THEME_STORAGE_KEY, 'light');
        run();
        expect(htmlIsDark()).toBe(false);

        systemDark = false;
        localStorage.setItem(THEME_STORAGE_KEY, 'dark');
        run();
        expect(htmlIsDark()).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe('dark');
    });
});

describe('ThemeProvider', () => {
    it('默认自动跟随系统，系统切换深色时随之切换', async () => {
        await render();
        expect(probe().dataset.preference).toBe('system');
        expect(htmlIsDark()).toBe(false);

        act(() => setSystemDark(true));
        expect(probe().dataset.theme).toBe('dark');
        expect(htmlIsDark()).toBe(true);
    });

    it('手动切换后写入本地缓存并覆盖系统设置；未登录时不请求接口', async () => {
        systemDark = true;
        await render();

        act(() => setPreference('light'));
        expect(probe().dataset.theme).toBe('light');
        expect(htmlIsDark()).toBe(false);
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
        expect(mocks.patch).not.toHaveBeenCalled();
    });

    it('登录后采用账号中保存的偏好，切换时保存到账号', async () => {
        mocks.session = { status: 'authenticated', data: { user: { email: 'a@example.com' } } };
        mocks.get.mockResolvedValue({ themePreference: 'dark' });
        await render();

        expect(mocks.get).toHaveBeenCalledWith('/api/user');
        expect(probe().dataset.preference).toBe('dark');
        expect(htmlIsDark()).toBe(true);
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

        act(() => setPreference('system'));
        expect(mocks.patch).toHaveBeenCalledWith('/api/user', { themePreference: 'system' });
        expect(htmlIsDark()).toBe(false);
    });

    it('账号中的偏好不合法时保留本地缓存', async () => {
        localStorage.setItem(THEME_STORAGE_KEY, 'dark');
        mocks.session = { status: 'authenticated', data: { user: { email: 'a@example.com' } } };
        mocks.get.mockResolvedValue({ themePreference: 'purple' });
        await render();

        expect(probe().dataset.preference).toBe('dark');
    });

    it('深色模式下打印时切换为浅色并在打印结束后恢复', async () => {
        systemDark = true;
        await render();
        expect(htmlIsDark()).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe('dark');

        act(() => {
            window.dispatchEvent(new Event('beforeprint'));
        });
        expect(htmlIsDark()).toBe(false);
        expect(document.documentElement.style.colorScheme).toBe('light');

        act(() => {
            window.dispatchEvent(new Event('afterprint'));
        });
        expect(htmlIsDark()).toBe(true);
        expect(document.documentElement.style.colorScheme).toBe('dark');
    });

    it('全局样式将深色主题限定在屏幕媒体并在打印时强制白底深字', () => {
        const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');
        expect(css).toContain(':root,\n.exam-sheet');
        expect(css).toMatch(/@media screen\s*\{\s*\.dark\s*\{/);
        expect(css).toMatch(/@media print\s*\{[\s\S]*?:root,\s*\.dark\s*\{[\s\S]*?color-scheme:\s*light\s*!important/);
    });
});
