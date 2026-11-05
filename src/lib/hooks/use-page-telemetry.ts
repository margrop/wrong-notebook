import { useEffect, useRef } from "react";
import { trackAppOpened, trackEvent } from "@/lib/telemetry/client";
import { normalizePage } from "@/lib/telemetry/schema";

/** 匿名埋点：每个会话记录一次 app_opened；页面枚举变化时记录 page_viewed（不含路径与 ID） */
export function usePageTelemetry(pathname: string, enabled: boolean) {
    const lastPage = useRef<string | null>(null);

    useEffect(() => {
        trackAppOpened();
    }, []);

    useEffect(() => {
        if (!enabled) return;
        const page = normalizePage(pathname);
        if (page === lastPage.current) return;
        lastPage.current = page;
        trackEvent("page_viewed", { page });
    }, [pathname, enabled]);
}
