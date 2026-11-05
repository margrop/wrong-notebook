/** 管理员遥测接口的响应，前后端共用 */
export interface TelemetryAdminStatus {
    recording: boolean;
    errors: boolean;
    /** 配置中的外发开关 */
    forwarding: boolean;
    /** 外发实际是否生效（已同意协议、未被环境变量禁用） */
    forwardingActive: boolean;
    /** 配置的自定义地址，空串表示使用官方地址 */
    endpoint: string;
    defaultEndpoint: string;
    retentionDays: number;
    lockedByEnv: boolean;
    consentPending: boolean;
    eula: { current: string; acceptedVersion: string | null; acceptedAt: string | null };
    /** 存量实例显示告知横幅：从未同意协议、外发关闭、未被关闭过 */
    showNotice: boolean;
    pending: number;
    lastFlushAt: string | null;
    lastAttempt: { at: string; status: "sent" | "failed" | "stopped"; httpStatus?: number } | null;
}

export interface TelemetryRecentEvent {
    id: string;
    name: string;
    payload: string | null;
    createdAt: string;
    forwardedAt: string | null;
}

export interface TelemetryRecentError {
    id: string;
    kind: string;
    scope: string;
    name: string;
    fingerprint: string;
    message: string | null;
    path: string | null;
    createdAt: string;
    forwardedAt: string | null;
}

export interface TelemetryAdminResponse extends TelemetryAdminStatus {
    events: TelemetryRecentEvent[];
    errorRecords: TelemetryRecentError[];
}
