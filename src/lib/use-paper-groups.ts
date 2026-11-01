"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";

export interface PaperGroup {
    id: string;
    name: string;
    key: string | null;
    order: number;
    isActive: boolean;
    _count?: { errorItems: number };
}

// 简单内存缓存，30 秒内不重复拉
let cachedGroups: PaperGroup[] | null = null;
let cachedAt = 0;
const CACHE_TTL = 30_000;
const subscribers = new Set<(groups: PaperGroup[]) => void>();

export function invalidatePaperGroupsCache() {
    cachedGroups = null;
    cachedAt = 0;
}

/**
 * 拉取当前用户的卷别分组列表（含停用），带 30s 客户端缓存。
 * 用于所有卷别下拉/筛选/管理页。
 */
export function usePaperGroups() {
    const [groups, setGroups] = useState<PaperGroup[]>(cachedGroups ?? []);
    const [loading, setLoading] = useState(!cachedGroups);
    const [error, setError] = useState<string | null>(null);

    const fetchGroups = useCallback(async (force = false) => {
        const now = Date.now();
        if (!force && cachedGroups && now - cachedAt < CACHE_TTL) {
            setGroups(cachedGroups);
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const data = await apiClient.get<PaperGroup[]>("/api/paper-groups");
            cachedGroups = data;
            cachedAt = now;
            // 设置页刷新后，通知已挂载的录入、筛选和详情组件更新选项。
            subscribers.forEach((subscriber) => subscriber(data));
            setError(null);
        } catch (err) {
            frontendLogger.error("[usePaperGroups]", "Failed to fetch paper groups", { error: err });
            setError("Failed to load paper groups");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        subscribers.add(setGroups);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面时加载分组
        fetchGroups();
        return () => { subscribers.delete(setGroups); };
    }, [fetchGroups]);

    const refetch = useCallback(() => {
        invalidatePaperGroupsCache();
        return fetchGroups(true);
    }, [fetchGroups]);

    return { groups, loading, error, refetch };
}
