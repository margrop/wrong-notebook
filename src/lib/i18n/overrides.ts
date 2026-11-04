import type { Translations } from '@/lib/translations';

/** 深度 Partial：只允许覆盖已存在的 key，拼错 key 会在编译期报错 */
export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends (infer U)[]
        ? U[]
        : T[K] extends Record<string, unknown>
          ? DeepPartial<T[K]>
          : T[K];
};

/**
 * fork 项目的界面文案覆盖。上游保持为空对象。
 * 在 fork 中新建自己的模块（如 src/lib/i18n/bank-zh.ts）维护覆盖内容，
 * 再 import 到这里赋值，避免直接修改本文件造成与上游冲突。
 *
 * 注意：本文件只能 import type，避免与 src/lib/translations.ts 形成循环依赖。
 */
export const TRANSLATION_OVERRIDES: { zh?: DeepPartial<Translations>; en?: DeepPartial<Translations> } = {};
