"use client";

import { useEffect, useState } from "react";

/** 定时更新的当前时间（毫秒），用于显示实时用时；enabled 为 false 时停止更新 */
export function useNow(enabled: boolean, intervalMs = 1000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!enabled) return;
        const timer = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(timer);
    }, [enabled, intervalMs]);
    return now;
}
