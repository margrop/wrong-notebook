"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import type { TagStats } from "@/types/api";
import { SUBJECTS, getSubjectName } from "./tag-subjects";
import type { SubjectKey, TagTreeNode } from "./tag-subjects";
import { TagTreeNodeView } from "./tag-tree-node";

interface StandardTagsProps {
    tagSet: string;
    stats: TagStats[];
}

/** 标准标签库：按学科折叠，展开时按需加载当前标签体系的标签树 */
export function StandardTags({ tagSet, stats }: StandardTagsProps) {
    const { t } = useLanguage();
    // 未出现的学科表示尚未加载，[] 表示已加载但无数据
    const [tagsBySubject, setTagsBySubject] = useState<Partial<Record<SubjectKey, TagTreeNode[]>>>({});
    const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
    // 按标签 ID 查使用次数，避免不同学科、体系的同名标签互相串数
    const countByTagId = useMemo(() => {
        const map = new Map<string, number>();
        for (const stat of stats) {
            if (stat.tagSet !== tagSet) continue;
            for (const id of stat.tagIds) map.set(id, stat.count);
        }
        return map;
    }, [stats, tagSet]);

    const fetchTags = useCallback(async (subject: SubjectKey) => {
        try {
            const data = await apiClient.get<{ tags: TagTreeNode[] }>(`/api/tags?subject=${subject}&tagSet=${encodeURIComponent(tagSet)}`);
            setTagsBySubject(prev => ({ ...prev, [subject]: data.tags }));
        } catch (error) {
            frontendLogger.error('[Tags]', 'Failed to fetch tags', { subject, tagSet, error });
        }
    }, [tagSet]);

    useEffect(() => {
        // 默认预加载数学标签
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面时加载标签数据
        fetchTags('math');
    }, [fetchTags]);

    const toggleNode = (nodeId: string) => {
        setExpandedNodes(prev => ({ ...prev, [nodeId]: !prev[nodeId] }));
    };

    return (
        <>
            {SUBJECTS.map(({ key, name }) => {
                const isExpanded = expandedNodes[`subject-${key}`];
                const tags = tagsBySubject[key];
                const systemTags = tags?.filter(tag => tag.isSystem) ?? [];

                return (
                    <Card key={key} className="mb-4">
                        <CardHeader
                            className="cursor-pointer hover:bg-muted/50 transition-colors flex flex-row items-center justify-between py-4"
                            onClick={() => {
                                toggleNode(`subject-${key}`);
                                if (!tags) fetchTags(key);
                            }}
                        >
                            <CardTitle className="text-lg flex items-center gap-2">
                                {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                                {getSubjectName(t.tags?.subjects, key, name)}
                            </CardTitle>
                            <span className="text-sm text-muted-foreground">
                                {isExpanded ? (t.common?.collapse || "Collapse") : (t.common?.expand || "Expand")}
                            </span>
                        </CardHeader>
                        {isExpanded && (
                            <CardContent className="space-y-4 pt-0">
                                {!tags ? (
                                    <div className="text-center py-4 text-muted-foreground">
                                        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                                        {t.tags?.stats?.loading || "Loading..."}
                                    </div>
                                ) : systemTags.length === 0 ? (
                                    <div className="text-center py-4 text-muted-foreground">
                                        {t.tags?.stats?.empty || "No tag usage records yet"}
                                    </div>
                                ) : (
                                    systemTags.map(node => (
                                        <TagTreeNodeView key={node.id} node={node} countByTagId={countByTagId} expandedNodes={expandedNodes} onToggle={toggleNode} />
                                    ))
                                )}
                            </CardContent>
                        )}
                    </Card>
                );
            })}
        </>
    );
}
