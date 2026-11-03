import type { PaginatedResponse, PrintableErrorItem } from '@/types/api';

type PrintSelectableItem = {
    id: string;
};

/** 提取错题打印项的知识点名称：优先使用 tags 关联，旧数据回退到 knowledgePoints */
export function getPrintableItemTagNames(item: Pick<PrintableErrorItem, 'tags' | 'knowledgePoints'>): string[] {
    if (item.tags && item.tags.length > 0) return item.tags.map((tag) => tag.name);
    try {
        const parsed: unknown = JSON.parse(item.knowledgePoints || '[]');
        return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
    } catch {
        return [];
    }
}

export function getSelectedPrintItems<T extends PrintSelectableItem>(
    items: T[],
    selectedIds: Set<string>,
): T[] {
    return items.filter((item) => selectedIds.has(item.id));
}

export function shouldReserveAnswerSpace(showAnswers: boolean, showAnalysis: boolean): boolean {
    return !showAnswers && !showAnalysis;
}

export function getPrintPreviewCountLabel(totalCount: number, selectedCount: number): string {
    return selectedCount === totalCount
        ? String(totalCount)
        : `${selectedCount}/${totalCount}`;
}

export function getPrintPreviewEmptyState(
    totalCount: number,
    selectedCount: number,
): 'noItems' | 'noSelection' | null {
    if (totalCount === 0) return 'noItems';
    if (selectedCount === 0) return 'noSelection';
    return null;
}

/**
 * 逐页读取全部符合条件的题目，不因单页上限截断。
 * fetchPage 负责请求指定页码，返回分页结果。
 */
export async function fetchAllPages<T>(fetchPage: (page: number) => Promise<PaginatedResponse<T>>): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; ; page += 1) {
        const response = await fetchPage(page);
        items.push(...response.items);
        if (response.items.length === 0 || page >= response.totalPages) return items;
    }
}

/** 把数组切成不超过 size 的若干段，用于分批保存 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
    return result;
}
