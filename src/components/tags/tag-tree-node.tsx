"use client";

import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TagTreeNode } from "./tag-subjects";

interface TagTreeNodeViewProps {
    node: TagTreeNode;
    /** 标签 ID → 当前用户错题中的使用次数 */
    countByTagId: Map<string, number>;
    expandedNodes: Record<string, boolean>;
    onToggle: (nodeId: string) => void;
    depth?: number;
    isLeafContext?: boolean;
}

/** 标准标签树节点：叶子显示为 Badge，非叶子可展开 */
export function TagTreeNodeView({ node, countByTagId, expandedNodes, onToggle, depth = 0, isLeafContext = false }: TagTreeNodeViewProps) {
    const isExpanded = expandedNodes[node.id];
    const paddingLeft = depth * 16;

    if (node.children.length === 0) {
        const count = countByTagId.get(node.id);
        return (
            <Badge variant="outline" className="cursor-default hover:bg-accent" style={{ marginLeft: isLeafContext ? 0 : paddingLeft }}>
                {node.name}
                {count !== undefined && <span className="ml-1 text-xs text-muted-foreground">({count})</span>}
            </Badge>
        );
    }

    // 只显示系统标签子节点
    const visibleChildren = node.children.filter(child => child.isSystem);
    // 可见子节点都是叶子时用 flex-wrap 排列，否则垂直堆叠
    const allChildrenAreLeaves = visibleChildren.every(child => child.children.filter(c => c.isSystem).length === 0);

    return (
        <div className="space-y-2" style={{ paddingLeft }}>
            <div
                className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-2 py-1 -mx-2"
                onClick={() => onToggle(node.id)}
            >
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="font-medium text-sm">{node.name}</span>
                <span className="text-xs text-muted-foreground">({visibleChildren.length})</span>
            </div>
            {isExpanded && visibleChildren.length > 0 && (
                <div className={allChildrenAreLeaves ? "flex flex-wrap gap-2 pl-6" : "space-y-2 pl-6"}>
                    {visibleChildren.map(child => (
                        <TagTreeNodeView
                            key={child.id}
                            node={child}
                            countByTagId={countByTagId}
                            expandedNodes={expandedNodes}
                            onToggle={onToggle}
                            isLeafContext={allChildrenAreLeaves}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
