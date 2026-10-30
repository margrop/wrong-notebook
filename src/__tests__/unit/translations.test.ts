import { describe, expect, it } from 'vitest';
import { translations } from '@/lib/translations';

/** 列出对象中所有叶子节点的路径，如 settings.ai.save */
function leafPaths(value: unknown, prefix = ''): string[] {
    if (typeof value !== 'object' || value === null) return [prefix];
    return Object.entries(value).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
}

describe('界面文案', () => {
    it('中英文的文案 key 完全一致', () => {
        const en = new Set(leafPaths(translations.en));
        const zh = new Set(leafPaths(translations.zh));
        expect([...en].filter((path) => !zh.has(path)), '中文缺少').toEqual([]);
        expect([...zh].filter((path) => !en.has(path)), '英文缺少').toEqual([]);
    });

    it('没有空文案', () => {
        for (const language of ['en', 'zh'] as const) {
            const empty = leafPaths(translations[language]).filter((path) => {
                const text = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], translations[language]);
                return typeof text !== 'string' || text.trim() === '';
            });
            expect(empty, language).toEqual([]);
        }
    });

    it('英文文案不含中文字符', () => {
        const withChinese = leafPaths(translations.en).filter((path) => {
            const text = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], translations.en);
            return typeof text === 'string' && /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.test(text);
        });
        expect(withChinese).toEqual([]);
    });
});
