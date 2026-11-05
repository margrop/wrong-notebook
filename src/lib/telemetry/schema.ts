/**
 * 匿名遥测事件白名单，前后端共用（不依赖 Node 模块）。
 * 每个事件的 payload 只允许布尔值与枚举，结构上放不下自由文本；见 doc/TELEMETRY_DESIGN.md §4。
 */
import { z } from "zod";
import { VENDOR_PROVIDER_IDS } from "@/lib/ai/vendor-presets";
import { TTS_MODES } from "@/lib/tts/constants";
import type { AppConfig } from "@/lib/config/types";

/** 外发协议版本，与收集服务的 schema 字段一致 */
export const TELEMETRY_SCHEMA_VERSION = 1;

const BUILTIN_AI_PROVIDERS = ["gemini", "openai", "azure", "anthropic", "minimax-code"] as const;
/** 与 AppConfig['aiProvider'] 的取值一致 */
export const AI_PROVIDERS = [...BUILTIN_AI_PROVIDERS, ...VENDOR_PROVIDER_IDS] as [AppConfig["aiProvider"], ...AppConfig["aiProvider"][]];

export const TELEMETRY_PLATFORMS = ["docker", "npm", "desktop", "fnos", "android", "other"] as const;
export type TelemetryPlatform = typeof TELEMETRY_PLATFORMS[number];

export const TELEMETRY_CLIENTS = ["browser", "pwa", "desktop", "android"] as const;

export const TELEMETRY_PAGES = [
    "home", "notebooks", "error_detail", "practice", "review", "stats", "tags", "exams", "settings", "admin", "other",
] as const;
export type TelemetryPage = typeof TELEMETRY_PAGES[number];

export const SETTINGS_SECTIONS = ["general", "ai", "tts", "prompts", "telemetry"] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];

export const COUNT_BUCKETS = ["1", "2-5", "6-20", ">20"] as const;
export const ROWS_BUCKETS = ["0", "1-50", "51-500", ">500"] as const;
export const DURATION_BUCKETS = ["<3s", "3-10s", "10-30s", ">30s"] as const;

const provider = z.enum(AI_PROVIDERS);
const ok = z.boolean();

export const TELEMETRY_EVENT_SCHEMAS = {
    app_installed: z.strictObject({ method: z.enum(["setup-token", "preset-admin"]) }),
    eula_accepted: z.strictObject({
        version: z.string().regex(/^v\d{1,4}$/),
        // install：初始化或安装向导；upgrade：协议升级后重新同意；settings：存量实例在设置中首次同意
        trigger: z.enum(["install", "upgrade", "settings"]),
    }),
    instance_alive: z.strictObject({ platform: z.enum(TELEMETRY_PLATFORMS), aiConfigured: z.boolean() }),
    app_opened: z.strictObject({ client: z.enum(TELEMETRY_CLIENTS) }),
    page_viewed: z.strictObject({ page: z.enum(TELEMETRY_PAGES) }),
    ai_analyze_started: z.strictObject({ provider }),
    ai_analyze_result: z.strictObject({ ok, provider, duration: z.enum(DURATION_BUCKETS) }),
    ai_reanswer: z.strictObject({ ok, provider }),
    ai_practice_grading: z.strictObject({ ok, count: z.enum(COUNT_BUCKETS) }),
    exam_paper_generation: z.strictObject({ ok, count: z.enum(COUNT_BUCKETS) }),
    data_exported: z.strictObject({ scope: z.enum(["user", "all"]), rows: z.enum(ROWS_BUCKETS) }),
    data_imported: z.strictObject({ rows: z.enum(ROWS_BUCKETS) }),
    tts_used: z.strictObject({ mode: z.enum(TTS_MODES) }),
    settings_changed: z.strictObject({ section: z.enum(SETTINGS_SECTIONS) }),
} as const;

export type TelemetryEventName = keyof typeof TELEMETRY_EVENT_SCHEMAS;
export type TelemetryEventPayloads = { [N in TelemetryEventName]: z.infer<typeof TELEMETRY_EVENT_SCHEMAS[N]> };
export const TELEMETRY_EVENT_NAMES = Object.keys(TELEMETRY_EVENT_SCHEMAS) as TelemetryEventName[];

/** 浏览器可上报的事件；其余（安装、同意、存活）只能由服务端记录 */
export const CLIENT_EVENT_NAMES = [
    "app_opened", "page_viewed", "ai_analyze_started", "ai_analyze_result", "ai_reanswer", "ai_practice_grading",
    "exam_paper_generation", "data_exported", "data_imported", "tts_used", "settings_changed",
] as const satisfies readonly TelemetryEventName[];
export type ClientEventName = typeof CLIENT_EVENT_NAMES[number];

export function isTelemetryEventName(value: unknown): value is TelemetryEventName {
    return typeof value === "string" && Object.hasOwn(TELEMETRY_EVENT_SCHEMAS, value);
}

/** 校验并返回规范化的 payload；不合法时返回 null */
export function parseEventPayload<N extends TelemetryEventName>(name: N, payload: unknown): TelemetryEventPayloads[N] | null {
    const result = TELEMETRY_EVENT_SCHEMAS[name].safeParse(payload ?? {});
    return result.success ? (result.data as TelemetryEventPayloads[N]) : null;
}

export const ERROR_KINDS = ["client", "boundary", "server"] as const;
export type TelemetryErrorKind = typeof ERROR_KINDS[number];

/** 错误作用域：短 token，允许命名空间冒号与 [GlobalError] 的方括号，与收集服务一致 */
export const ERROR_SCOPE_PATTERN = /^[A-Za-z0-9_.:[\]-]{1,64}$/;

/** 把错误名称规整为收集服务接受的形式（字母开头、最多 64 位） */
export function normalizeErrorName(value: unknown): string {
    const name = typeof value === "string" ? value.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64) : "";
    return /^[A-Za-z]/.test(name) ? name : "Error";
}

const PAGE_RULES: Array<[RegExp, TelemetryPage]> = [
    [/^\/$/, "home"],
    [/^\/notebooks?(\/|$)/, "notebooks"],
    [/^\/error-items?\/[^/]+/, "error_detail"],
    [/^\/practice(\/|$)/, "practice"],
    [/^\/review(\/|$)/, "review"],
    [/^\/stats(\/|$)/, "stats"],
    [/^\/tags(\/|$)/, "tags"],
    [/^\/exams?(\/|$)/, "exams"],
    [/^\/(settings|setup)(\/|$)/, "settings"],
    [/^\/admin(\/|$)/, "admin"],
];

/** 把路径映射成页面枚举，未知路径记为 other；不保留任何 ID */
export function normalizePage(pathname: string): TelemetryPage {
    const path = pathname.split(/[?#]/)[0] || "/";
    return PAGE_RULES.find(([pattern]) => pattern.test(path))?.[1] ?? "other";
}

function bucket<T extends string>(value: number, edges: number[], labels: readonly T[]): T {
    const index = edges.findIndex((edge) => value <= edge);
    return labels[index === -1 ? labels.length - 1 : index];
}

/** 题目数量分桶：1 | 2-5 | 6-20 | >20 */
export function countBucket(count: number): typeof COUNT_BUCKETS[number] {
    return bucket(Math.max(1, count), [1, 5, 20], COUNT_BUCKETS);
}

/** 导入导出行数分桶：0 | 1-50 | 51-500 | >500 */
export function rowsBucket(rows: number): typeof ROWS_BUCKETS[number] {
    return bucket(Math.max(0, rows), [0, 50, 500], ROWS_BUCKETS);
}

/** 耗时分桶：<3s | 3-10s | 10-30s | >30s */
export function durationBucket(ms: number): typeof DURATION_BUCKETS[number] {
    return bucket(ms, [2999, 9999, 29999], DURATION_BUCKETS);
}
