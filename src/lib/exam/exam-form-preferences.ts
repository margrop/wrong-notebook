import type { ExamMode, ExamPickRule, ExamScope } from "@/types/api";

/** 组卷表单在本机浏览器中记住的偏好；科目、标签等每次不同的条件不保存 */
export const EXAM_FORM_PREFERENCES_STORAGE_KEY = "exam-form-preferences";

export const EXAM_FORM_SCOPES: readonly ExamScope[] = ["unmastered", "mastered", "all"];
export const EXAM_FORM_PICK_RULES: readonly ExamPickRule[] = ["least_practiced", "random"];
export const EXAM_FORM_MODES: readonly ExamMode[] = ["generate", "original"];
export const EXAM_FORM_DIFFICULTIES = ["easy", "medium", "hard", "harder"] as const;
export type ExamFormDifficulty = typeof EXAM_FORM_DIFFICULTIES[number];
export const EXAM_FORM_MAX_COUNT = 50;

export interface ExamFormPreferences {
    mode: ExamMode;
    scope: ExamScope;
    pickRule: ExamPickRule;
    count: number;
    difficulty: ExamFormDifficulty;
}

export const DEFAULT_EXAM_FORM_PREFERENCES: ExamFormPreferences = {
    mode: "generate",
    scope: "unmastered",
    pickRule: "least_practiced",
    count: 10,
    difficulty: "medium",
};

function pick<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
    return typeof value === "string" && (options as readonly string[]).includes(value) ? value as T : fallback;
}

/** 题数限制在 1–50 的整数 */
export function clampExamCount(value: number): number {
    return Math.min(EXAM_FORM_MAX_COUNT, Math.max(1, Math.round(value)));
}

/** 解析本机保存的组卷偏好；字段缺失或不合法时逐项回退默认值 */
export function parseExamFormPreferences(raw: string | null): ExamFormPreferences {
    const defaults = DEFAULT_EXAM_FORM_PREFERENCES;
    if (!raw) return { ...defaults };
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ...defaults };
    }
    if (!parsed || typeof parsed !== "object") return { ...defaults };
    const stored = parsed as Record<string, unknown>;
    return {
        mode: pick(EXAM_FORM_MODES, stored.mode, defaults.mode),
        scope: pick(EXAM_FORM_SCOPES, stored.scope, defaults.scope),
        pickRule: pick(EXAM_FORM_PICK_RULES, stored.pickRule, defaults.pickRule),
        count: typeof stored.count === "number" && Number.isFinite(stored.count) ? clampExamCount(stored.count) : defaults.count,
        difficulty: pick(EXAM_FORM_DIFFICULTIES, stored.difficulty, defaults.difficulty),
    };
}

export function serializeExamFormPreferences(preferences: ExamFormPreferences): string {
    return JSON.stringify(preferences);
}
