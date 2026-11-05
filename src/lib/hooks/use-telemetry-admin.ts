import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import type { TelemetryAdminResponse, TelemetryAdminStatus } from "@/lib/telemetry/types";

const URL = "/api/admin/telemetry";

export interface TelemetryChanges {
    recording?: boolean;
    errors?: boolean;
    forwarding?: boolean;
    endpoint?: string;
    retentionDays?: number;
    noticeDismissed?: true;
}

/** 同意当前版本的使用协议后开启外发（存量实例首次开启外发时使用） */
export async function acceptEulaAndEnableForwarding(version: string): Promise<TelemetryAdminResponse> {
    await apiClient.post("/api/admin/eula/accept", { version });
    return apiClient.post<TelemetryAdminResponse>(URL, { forwarding: true });
}

export function updateTelemetry(changes: TelemetryChanges): Promise<TelemetryAdminResponse> {
    return apiClient.post<TelemetryAdminResponse>(URL, changes);
}

/** 管理员遥测面板的数据：打开时加载一次，操作后用接口返回值刷新 */
export function useTelemetryAdmin() {
    const [data, setData] = useState<TelemetryAdminResponse | null>(null);

    const refresh = useCallback(async () => {
        try {
            setData(await apiClient.get<TelemetryAdminResponse>(URL));
        } catch (error) {
            frontendLogger.warn("[TelemetrySettings]", "Failed to load telemetry status", { error });
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：打开面板时加载遥测状态
        refresh();
    }, [refresh]);

    return {
        data,
        update: async (changes: TelemetryChanges) => setData(await updateTelemetry(changes)),
        enableWithConsent: async (version: string) => setData(await acceptEulaAndEnableForwarding(version)),
        clear: async () => setData(await apiClient.delete<TelemetryAdminResponse>(URL)),
    };
}

/** 横幅只需要状态，不触发清理也不取记录 */
export function fetchTelemetryNotice(): Promise<TelemetryAdminStatus> {
    return apiClient.get<TelemetryAdminStatus>(`${URL}?view=notice`);
}
