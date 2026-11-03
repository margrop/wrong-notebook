import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";

export const DEFAULT_TAG_SET = "default";

interface TagSetLabels {
    tagSetDefault?: string;
    tagSetNames?: Record<string, string>;
}

/** 标签体系的界面名称：内置体系用 tagSetDefault，其他体系查 tagSetNames，缺省回退体系标识 */
export function getTagSetName(labels: TagSetLabels | undefined, tagSet: string): string {
    if (tagSet === DEFAULT_TAG_SET) return labels?.tagSetDefault || "Built-in";
    return labels?.tagSetNames?.[tagSet] || tagSet;
}

/** 加载系统标签库中可用的标签体系列表，内置体系始终排在第一位 */
export function useTagSets() {
    const [tagSets, setTagSets] = useState<string[]>([DEFAULT_TAG_SET]);

    useEffect(() => {
        let cancelled = false;
        apiClient.get<{ tagSets: string[] }>("/api/tags?tagSetsOnly=true")
            .then((data) => {
                if (cancelled) return;
                const others = (data.tagSets ?? []).filter((ts) => ts !== DEFAULT_TAG_SET).sort();
                setTagSets([DEFAULT_TAG_SET, ...others]);
            })
            .catch((error) => {
                frontendLogger.error('[Tags]', 'Failed to fetch tag sets', { error });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return tagSets;
}
