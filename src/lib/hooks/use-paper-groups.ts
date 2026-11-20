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
let pendingRequest: Promise<void> | null = null;
const CACHE_TTL = 30_000;
const subscribers = new Set<(groups: PaperGroup[]) => void>();

export function invalidatePaperGroupsCache() {
    cachedGroups = null;
    cachedAt = 0;
    pendingRequest = null;
}

function requestPaperGroups() {
    if (pendingRequest) return pendingRequest;
    const request = apiClient.get<PaperGroup[]>("/api/paper-groups", { cache: "no-store" })
        .then((groups) => {
            // 分组更新后，忽略此前发出但较晚返回的请求。
            if (pendingRequest !== request) return;
            cachedGroups = groups;
            cachedAt = Date.now();
            subscribers.forEach((subscriber) => subscriber(groups));
        })
        .finally(() => {
            if (pendingRequest === request) pendingRequest = null;
        });
    pendingRequest = request;
    return request;
}

/** 分组变更或保存被拒绝时，刷新当前页的所有卷别选项。 */
export function refreshPaperGroups() {
    invalidatePaperGroupsCache();
    return requestPaperGroups();
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
        if (!force && cachedGroups && Date.now() - cachedAt < CACHE_TTL) {
            setGroups(cachedGroups);
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            await (force ? refreshPaperGroups() : requestPaperGroups());
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

    const refetch = useCallback(() => fetchGroups(true), [fetchGroups]);

    return { groups, loading, error, refetch };
}
