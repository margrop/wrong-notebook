import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import type { EulaStatus } from "@/lib/eula/types";

/**
 * 协议升级门禁：管理员登录后检查一次协议状态，待重新同意时由调用方显示无法关闭的对话框。
 * 普通用户不请求（服务端也始终返回 pending:false）
 */
export function useEulaGate(enabled: boolean) {
    const [status, setStatus] = useState<EulaStatus | null>(null);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        apiClient.get<EulaStatus>("/api/eula/status")
            .then((data) => { if (!cancelled) setStatus(data); })
            .catch((error) => frontendLogger.warn("[EulaGate]", "Failed to check EULA status", { error }));
        return () => { cancelled = true; };
    }, [enabled]);

    const accept = useCallback(async () => {
        if (!status) return;
        setStatus(await apiClient.post<EulaStatus>("/api/admin/eula/accept", { version: status.current }));
    }, [status]);

    return { pending: enabled && !!status?.pending, status, accept };
}
