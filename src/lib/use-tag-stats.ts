import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import type { TagStats, TagStatsResponse } from "@/types/api";

/** 加载当前用户的知识点使用次数统计；传入 tagSet 时只统计该标签体系 */
export function useTagStats(tagSet?: string) {
    const [stats, setStats] = useState<TagStats[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const query = tagSet ? `?tagSet=${encodeURIComponent(tagSet)}` : "";
        apiClient.get<TagStatsResponse>(`/api/tags/stats${query}`)
            .then((data) => {
                if (!cancelled) setStats(data.stats);
            })
            .catch((error) => {
                frontendLogger.error('[Tags]', 'Failed to fetch tag stats', { error });
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [tagSet]);

    return { stats, loading };
}
