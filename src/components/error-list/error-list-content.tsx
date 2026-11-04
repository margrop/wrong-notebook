"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { GitCompareArrows, Inbox, ListChecks, Printer, Search } from "lucide-react";
import { ErrorItemCard } from "@/components/error-list/error-item-card";
import { FilterMenu } from "@/components/error-list/filter-menu";
import { PaperLevelFilter } from "@/components/error-list/paper-level-filter";
import { QuestionTypeFilter } from "@/components/error-list/question-type-filter";
import { ErrorListSelectionBar } from "@/components/error-list-selection-bar";
import { KnowledgeFilter } from "@/components/knowledge-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { buildErrorListParams } from "@/lib/error-list/error-list-filters";
import { NO_QUESTION_TYPE } from "@/lib/question/question-type";
import { confirmDialog, toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { locateByShortId } from "@/lib/short-id/short-id-client";
import { isShortId } from "@/lib/short-id/short-id-format";
import type { ErrorListFilters, PaperLevelFilter as PaperLevel, TimeFilter } from "@/lib/error-list/error-list-filters";
import type { MasteryStatus } from "@/lib/mastery-status";
import type { ErrorItemSummary, PaginatedResponse } from "@/types/api";

interface ErrorListContentProps {
    subjectId?: string;
    subjectName?: string;
    tagSet?: string;
    /** 首次进入时的初始筛选（由外层从 URL 解析后传入），之后改筛选不回写 */
    initialMastery?: MasteryStatus;
    initialTag?: string;
}

type KnowledgeFilterChange = {
    gradeSemester?: string;
    chapter?: string;
    tag?: string | null;
};

export function ErrorListContent({ subjectId, subjectName, tagSet = 'default', initialMastery, initialTag }: ErrorListContentProps) {
    const { t } = useLanguage();
    const router = useRouter();
    const [items, setItems] = useState<ErrorItemSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [masteryFilter, setMasteryFilter] = useState<"all" | MasteryStatus>(initialMastery ?? "all");
    const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
    const [gradeFilter, setGradeFilter] = useState("");
    const [chapterFilter, setChapterFilter] = useState("");
    const [paperLevelFilter, setPaperLevelFilter] = useState<PaperLevel>("all");
    const [questionTypesFilter, setQuestionTypesFilter] = useState<string[]>([]);
    const [selectedTag, setSelectedTag] = useState<string | null>(initialTag ?? null);
    // 分页状态
    const [page, setPage] = useState(1);
    const pageSize = DEFAULT_PAGE_SIZE;
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    // 多选模式状态
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isDeleting, setIsDeleting] = useState(false);

    const filters: ErrorListFilters = useMemo(() => ({
        subjectId, search, mastery: masteryFilter, timeRange: timeFilter, tag: selectedTag,
        gradeSemester: gradeFilter, chapter: chapterFilter, paperLevel: paperLevelFilter,
        questionTypes: questionTypesFilter.map((value) => value === NO_QUESTION_TYPE ? "none" : value) as ErrorListFilters["questionTypes"],
    }), [subjectId, search, masteryFilter, timeFilter, selectedTag, gradeFilter, chapterFilter, paperLevelFilter, questionTypesFilter]);

    const handleFilterChange = ({ gradeSemester, chapter, tag }: KnowledgeFilterChange) => {
        if (gradeSemester !== undefined) setGradeFilter(gradeSemester);
        if (chapter !== undefined) setChapterFilter(chapter);
        // KnowledgeFilter 清除标签时传入 { tag: undefined }，统一转成 null
        setSelectedTag(tag === undefined ? null : tag);

        // 清除年级时一并清除章节和标签，清除章节时只清章节
        if (!gradeSemester) {
            setGradeFilter("");
            setChapterFilter("");
            setSelectedTag(null);
        } else if (!chapter) {
            setChapterFilter("");
        }
        setPage(1); // 筛选变化时重置页码
    };

    // 多选模式相关函数
    const toggleSelectMode = () => {
        setIsSelectMode(!isSelectMode);
        setSelectedIds(new Set());
    };

    const toggleSelectItem = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const fetchItems = useCallback(async () => {
        setLoading(true);
        try {
            const params = buildErrorListParams(filters);
            params.append("page", page.toString());
            params.append("pageSize", pageSize.toString());
            const response = await apiClient.get<PaginatedResponse<ErrorItemSummary>>(`/api/error-items/list?${params.toString()}`);
            setItems(response.items);
            setTotal(response.total);
            setTotalPages(response.totalPages);
        } catch (error) {
            frontendLogger.error('[ErrorList]', 'Failed to fetch error items', { error });
        } finally {
            setLoading(false);
        }
    }, [filters, page, pageSize]);

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;

        const confirmMsg = (t.notebook?.confirmBatchDelete || "Delete {count} items?").replace("{count}", selectedIds.size.toString());
        if (!(await confirmDialog(confirmMsg, { destructive: true }))) return;

        setIsDeleting(true);
        try {
            await apiClient.post("/api/error-items/batch-delete", { ids: Array.from(selectedIds) });
            toast.success(t.notebook?.batchDeleteSuccess || "Deleted successfully");
            setIsSelectMode(false);
            setSelectedIds(new Set());
            fetchItems();
        } catch (error) {
            frontendLogger.error('[ErrorList]', 'Batch delete failed', { error });
            toast.error(t.common?.messages?.deleteFailed || "Delete failed");
        } finally {
            setIsDeleting(false);
        }
    };

    // 追踪筛选条件是否变化（用于判断是否需要重置页码）
    const prevFiltersRef = useRef(filters);

    useEffect(() => {
        const filtersChanged = prevFiltersRef.current !== filters;
        prevFiltersRef.current = filters;

        if (filtersChanged && page !== 1) {
            // 筛选条件变化且不在第一页，重置到第一页（会再次触发此 effect）
            setPage(1);
            return;
        }

        fetchItems();
    }, [page, filters, fetchItems]);

    return (
        <div className={`space-y-6 ${isSelectMode ? "pb-40 sm:pb-24" : ""}`}>
            <div className="flex flex-col gap-3 lg:flex-row">
                <div className="relative w-full lg:flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder={t.notebook.search}
                        title={t.shortId.searchHint}
                        className="h-10 rounded-xl bg-card pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={async (e) => {
                            // 输入完整短 ID 后回车，直接打开对应题目
                            const value = search.trim();
                            if (e.key !== "Enter" || !isShortId(value)) return;
                            const id = await locateByShortId(value);
                            if (id) router.push(`/error-items/${id}`);
                        }}
                    />
                </div>
                <div className="flex flex-wrap gap-2">
                    <FilterMenu mastery={masteryFilter} timeRange={timeFilter} onMasteryChange={setMasteryFilter} onTimeRangeChange={setTimeFilter} />
                    <Button variant="outline" size="sm" className="h-10" onClick={() => router.push(`/print-preview?${buildErrorListParams(filters).toString()}`)}>
                        <Printer className="mr-2 h-4 w-4" />
                        {t.notebook?.exportPrint || "Export for Print"}
                    </Button>
                    {!isSelectMode && (
                        <Button variant="outline" size="sm" className="h-10" onClick={toggleSelectMode}>
                            <GitCompareArrows className="mr-2 h-4 w-4" />
                            {t.questionSimilarity.title}
                        </Button>
                    )}
                    <Button variant={isSelectMode ? "secondary" : "outline"} size="sm" className="h-10" onClick={toggleSelectMode}>
                        <ListChecks className="mr-2 h-4 w-4" />
                        {isSelectMode ? (t.notebook?.cancelSelect || "Cancel") : (t.notebook?.selectMode || "Select")}
                    </Button>
                </div>
            </div>

            {/* Advanced Filters Row */}
            <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
                <div className="w-full sm:w-auto">
                    <KnowledgeFilter gradeSemester={gradeFilter} tag={selectedTag} onFilterChange={handleFilterChange} subjectName={subjectName} tagSet={tagSet} />
                </div>
                <PaperLevelFilter value={paperLevelFilter} onChange={setPaperLevelFilter} />
            </div>

            <div className="space-y-2">
                <span className="text-sm text-muted-foreground">{t.questionType.label}</span>
                <QuestionTypeFilter value={questionTypesFilter} onChange={setQuestionTypesFilter} />
            </div>

            {selectedTag && (
                <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                    <span className="text-sm text-muted-foreground">
                        {t.filter.filteringByTag || "Filtering by tag"}:
                    </span>
                    <Badge variant="secondary" className="cursor-pointer" onClick={() => setSelectedTag(null)}>
                        {selectedTag}
                        <span className="ml-1 text-xs">×</span>
                    </Badge>
                </div>
            )}

            {!loading && items.length === 0 && (
                <EmptyState icon={Inbox} title={t.notebook.emptyList} description={t.notebook.emptyListHint} />
            )}

            {loading && items.length === 0 && (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="h-44 animate-pulse rounded-2xl bg-muted" />
                    ))}
                </div>
            )}

            <div className={`grid gap-4 md:grid-cols-2 lg:grid-cols-3 transition-opacity ${loading ? "opacity-60" : ""}`}>
                {items.map((item) => (
                    <ErrorItemCard
                        key={item.id}
                        item={item}
                        selectMode={isSelectMode}
                        selected={selectedIds.has(item.id)}
                        onToggleSelect={() => toggleSelectItem(item.id)}
                        selectedTag={selectedTag}
                        onTagClick={(tag) => setSelectedTag(selectedTag === tag ? null : tag)}
                    />
                ))}
            </div>

            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} />

            {isSelectMode && (
                <ErrorListSelectionBar selectedIds={[...selectedIds]} deleting={isDeleting} onCancel={toggleSelectMode} onDelete={handleBatchDelete} />
            )}
        </div>
    );
}
