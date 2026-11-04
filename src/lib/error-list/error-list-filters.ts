import { isMasteryStatus } from "@/lib/mastery-status";
import type { MasteryStatus } from "@/lib/mastery-status";
import { QUESTION_TYPES } from "@/lib/question/question-type";

export type PaperLevelFilter = string;
export type TimeFilter = "all" | "week" | "month";
/** 筛选「未设置题型」的占位值 */
export const QUESTION_TYPE_NONE = "none";
/** 错题列表可筛选的题型取值：标准 key 或 none（未设置） */
export type QuestionTypeFilterValue = (typeof QUESTION_TYPES)[number] | typeof QUESTION_TYPE_NONE;

/** 错题列表的筛选条件，列表请求和导出打印共用 */
export interface ErrorListFilters {
    subjectId?: string;
    search: string;
    mastery: "all" | MasteryStatus;
    timeRange: TimeFilter;
    tag: string | null;
    gradeSemester: string;
    chapter: string;
    paperLevel: PaperLevelFilter;
    /** 题型多选，空数组表示不限；含 "none" 时包含未设置题型的题 */
    questionTypes: QuestionTypeFilterValue[];
}

/** 转成 /api/error-items/list 与打印预览使用的查询参数，未筛选的条件不出现 */
export function buildErrorListParams(filters: ErrorListFilters): URLSearchParams {
    const params = new URLSearchParams();
    if (filters.subjectId) params.append("subjectId", filters.subjectId);
    if (filters.search) params.append("query", filters.search);
    if (filters.mastery !== "all") params.append("mastery", filters.mastery);
    if (filters.timeRange !== "all") params.append("timeRange", filters.timeRange);
    if (filters.tag) params.append("tag", filters.tag);
    if (filters.gradeSemester) params.append("gradeSemester", filters.gradeSemester);
    if (filters.chapter) params.append("chapter", filters.chapter);
    if (filters.paperLevel !== "all") params.append("paperLevel", filters.paperLevel);
    if (filters.questionTypes.length > 0) params.append("questionTypes", filters.questionTypes.join(","));
    return params;
}

/** 从地址参数解析错题列表的初始筛选（仅首次进入时作为 useState 初始值，之后改筛选不回写 URL） */
export interface ErrorListSearchParamsFilters {
    mastery?: MasteryStatus;
    tag?: string;
}

export function parseErrorListSearchParams(params: URLSearchParams): ErrorListSearchParamsFilters {
    const filters: ErrorListSearchParamsFilters = {};
    const mastery = params.get("mastery");
    if (isMasteryStatus(mastery)) {
        filters.mastery = mastery;
    }
    const tag = params.get("tag");
    if (tag) {
        filters.tag = tag;
    }
    return filters;
}

/**
 * 解析题型筛选参数（逗号分隔），非法值忽略而不是报错。
 * "none" 表示未设置题型的题（questionType 为 null）。
 */
export function parseQuestionTypeFilter(raw: string | null): QuestionTypeFilterValue[] {
    if (!raw) return [];
    const values: QuestionTypeFilterValue[] = [];
    for (const part of raw.split(",")) {
        const value = part.trim();
        if ((QUESTION_TYPES as readonly string[]).includes(value)) {
            if (!values.includes(value as QuestionTypeFilterValue)) {
                values.push(value as QuestionTypeFilterValue);
            }
        } else if (value === QUESTION_TYPE_NONE && !values.includes(QUESTION_TYPE_NONE)) {
            values.push(QUESTION_TYPE_NONE);
        }
    }
    return values;
}
