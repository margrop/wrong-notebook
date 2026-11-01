import type { PrintableErrorItem } from '@/types/api';

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
