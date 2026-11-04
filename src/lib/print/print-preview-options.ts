import { isAnswerSpaceMode } from "@/lib/exam/exam-answer-space";
import type { PrintDisplayOptions } from "@/components/print-preview/print-options";

/** 错题打印显示选项在本机浏览器中的保存键 */
export const PRINT_OPTIONS_STORAGE_KEY = "print-preview-options";

export const DEFAULT_PRINT_OPTIONS: PrintDisplayOptions = {
    showQuestionText: false,
    showAnswers: false,
    showAnalysis: false,
    showTags: false,
    imageScale: 70,
    answerSpace: "auto",
};

const BOOLEAN_KEYS = ["showQuestionText", "showAnswers", "showAnalysis", "showTags"] as const;

/** 解析本地保存的显示选项；字段缺失或不合法时回退默认值 */
export function parseStoredPrintOptions(raw: string | null): PrintDisplayOptions {
    const result: PrintDisplayOptions = { ...DEFAULT_PRINT_OPTIONS };
    if (!raw) return result;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return result;
    }
    if (!parsed || typeof parsed !== "object") return result;
    const stored = parsed as Record<string, unknown>;
    for (const key of BOOLEAN_KEYS) {
        if (typeof stored[key] === "boolean") result[key] = stored[key];
    }
    if (typeof stored.imageScale === "number" && Number.isFinite(stored.imageScale)) {
        result.imageScale = Math.min(100, Math.max(30, Math.round(stored.imageScale)));
    }
    if (isAnswerSpaceMode(stored.answerSpace)) result.answerSpace = stored.answerSpace;
    return result;
}

export function readStoredPrintOptions(): PrintDisplayOptions {
    try {
        return parseStoredPrintOptions(localStorage.getItem(PRINT_OPTIONS_STORAGE_KEY));
    } catch {
        return { ...DEFAULT_PRINT_OPTIONS };
    }
}

export function writeStoredPrintOptions(options: PrintDisplayOptions): void {
    try {
        localStorage.setItem(PRINT_OPTIONS_STORAGE_KEY, JSON.stringify(options));
    } catch {
        // 无痕模式等无法写入时只在本次生效
    }
}
