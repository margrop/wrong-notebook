import { en } from './i18n/en';
import { TRANSLATION_OVERRIDES } from './i18n/overrides';
import { zh } from './i18n/zh';

export type Language = 'zh' | 'en';

/** 界面文案的结构，以英文版为准 */
export type Translations = typeof en;

type AnyRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is AnyRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 深合并：仅合并普通对象；数组与函数整体替换；不修改任何入参 */
export function deepMerge<T>(base: T, override: T): T {
    if (!isPlainObject(base) || !isPlainObject(override)) {
        return override;
    }
    const result: AnyRecord = { ...base };
    for (const [key, value] of Object.entries(override)) {
        result[key] = key in result ? deepMerge(result[key], value) : value;
    }
    return result as T;
}

function applyOverrides(base: Translations, override: unknown): Translations {
    return override === undefined ? base : deepMerge(base, override as Translations);
}

export const translations = {
    en: applyOverrides(en, TRANSLATION_OVERRIDES.en),
    zh: applyOverrides(zh, TRANSLATION_OVERRIDES.zh),
};
