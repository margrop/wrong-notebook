interface TagHierarchyNode {
    id: string;
    parentId?: string | null;
}

/** 父节点排在子节点之前，兼容备份文件中的任意节点顺序。 */
export function sortTagsByParent<T extends TagHierarchyNode>(tags: T[]): T[] {
    const byId = new Map(tags.map((tag) => [tag.id, tag]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const sorted: T[] = [];

    function visit(tag: T) {
        if (visited.has(tag.id)) return;
        if (visiting.has(tag.id)) throw new Error('知识点标签存在循环父子关系');
        visiting.add(tag.id);
        const parent = tag.parentId ? byId.get(tag.parentId) : undefined;
        if (parent) visit(parent);
        visiting.delete(tag.id);
        visited.add(tag.id);
        sorted.push(tag);
    }

    tags.forEach(visit);
    return sorted;
}
