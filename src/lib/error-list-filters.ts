import type { MasteryStatus } from "@/lib/mastery-status";

export type PaperLevelFilter = string;
export type TimeFilter = "all" | "week" | "month";

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
    return params;
}
