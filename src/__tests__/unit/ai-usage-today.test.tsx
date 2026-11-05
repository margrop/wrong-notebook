/**
 * 管理员用户列表的今日 AI 用量：调用次数与按语言简写的 token 数
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiUsageToday } from '@/components/admin/ai-usage-today';
import { LanguageProvider, loadEnTranslations } from '@/contexts/LanguageContext';
import { formatTokenCount } from '@/lib/format-token-count';

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
    localStorage.clear();
    vi.unstubAllGlobals();
});

describe('formatTokenCount', () => {
    it('中文用万，英文用 K/M，保留一位小数', () => {
        expect(formatTokenCount(950, 'zh')).toBe('950');
        expect(formatTokenCount(123456, 'zh')).toBe('12.3万');
        expect(formatTokenCount(12345, 'en')).toBe('12.3K');
        expect(formatTokenCount(2_000_000, 'en')).toBe('2M');
        expect(formatTokenCount(-5, 'en')).toBe('0');
    });
});

describe('AiUsageToday', () => {
    it.each([
        ['zh', '今日 AI: 3 | 今日 token: 输入 1.2万 / 输出 800'],
        ['en', 'AI today: 3 | Tokens today: in 12K / out 800'],
    ])('%s 界面显示调用次数和输入、输出 token', async (language, expected) => {
        localStorage.setItem('app-language', language);
        // 英文文案按需加载，渲染前先加载完
        if (language === 'en') await loadEnTranslations();
        await act(async () => root.render(
            <LanguageProvider><AiUsageToday user={{ aiUsageToday: 3, aiTokensToday: { input: 12000, output: 800 } }} /></LanguageProvider>
        ));
        expect(container.textContent).toBe(expected);
    });
});
