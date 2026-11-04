/** 题目的知识点：优先取标签关联，回退到旧的 knowledgePoints JSON 字段 */
export function getItemTags(item: { tags?: { name: string }[] | null; knowledgePoints?: string | null }): string[] {
    if (item.tags && item.tags.length > 0) {
        return item.tags.map((tag) => tag.name);
    }
    if (!item.knowledgePoints) return [];
    try {
        const parsed: unknown = JSON.parse(item.knowledgePoints);
        return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
    } catch {
        return [];
    }
}
