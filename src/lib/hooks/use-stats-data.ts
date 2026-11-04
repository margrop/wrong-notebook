"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";

interface StatsDataState<T> {
    data: T | null;
    loading: boolean;
    error: boolean;
    reload: () => void;
}

/** 统计中心通用的数据请求 hook：处理加载中、失败、组件卸载后的取消 */
export function useStatsData<T>(url: string): StatsDataState<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;

        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：地址变化或重试时重新进入加载状态
        setLoading(true);
        setError(false);

        apiClient.get<T>(url)
            .then(result => {
                if (cancelled) return;
                setData(result);
            })
            .catch(err => {
                if (cancelled) return;
                frontendLogger.error('[useStatsData]', 'Failed to fetch stats', { url, error: err });
                setError(true);
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [url, reloadKey]);

    const reload = useCallback(() => {
        setReloadKey(k => k + 1);
    }, []);

    return { data, loading, error, reload };
}
