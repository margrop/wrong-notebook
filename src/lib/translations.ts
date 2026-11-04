import { en } from './i18n/en';
import { zh } from './i18n/zh';

export type Language = 'zh' | 'en';

export const translations = {
    en,
    zh,
};

/** 界面文案的结构，以英文版为准 */
export type Translations = typeof translations['en'];
