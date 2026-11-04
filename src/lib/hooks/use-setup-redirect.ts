import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";

/** 管理员进入应用时检查安装向导状态，全新安装未完成向导时跳转到 /setup（每次加载只检查一次） */
export function useSetupRedirect(isAdmin: boolean) {
    const router = useRouter();
    const checked = useRef(false);

    useEffect(() => {
        if (!isAdmin || checked.current) return;
        checked.current = true;
        apiClient.get<{ needsSetup: boolean }>("/api/setup")
            .then((data) => {
                if (data.needsSetup) router.replace("/setup");
            })
            .catch((error) => frontendLogger.warn('[Setup]', 'Failed to check setup status', { error }));
    }, [isAdmin, router]);
}
