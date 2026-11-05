import "server-only";

import { getAppConfig } from "@/lib/config";
import { EULA_VERSION } from "@/lib/eula";
import type { AppConfig } from "@/lib/config";

/** 官方收集服务地址（自有域名，CNAME 指向 Vercel） */
export const DEFAULT_TELEMETRY_ENDPOINT = "https://wrong-notebook-telemetry.margrop.net/api/v1/ingest";

export interface TelemetryState {
    /** 本地记录 */
    recording: boolean;
    /** 错误回报（本地记录或外发至少一个开启时才有意义） */
    errors: boolean;
    /** 外发实际是否生效：配置开启、未被环境变量禁用、协议不处于待重新同意 */
    forwarding: boolean;
    /** 配置中的外发开关，不考虑协议状态 */
    forwardingConfigured: boolean;
    /** 实际使用的收集服务地址 */
    endpoint: string;
    retentionDays: number;
    /** TELEMETRY_DISABLED=true 时强制全部关闭 */
    lockedByEnv: boolean;
    /** 管理员曾同意的协议版本低于当前版本，需要重新同意 */
    consentPending: boolean;
    /** 是否曾同意过任一版本的协议 */
    consentGiven: boolean;
}

export function isTelemetryDisabledByEnv(): boolean {
    return process.env.TELEMETRY_DISABLED?.trim().toLowerCase() === "true";
}

/** 根据配置计算遥测的实际开关状态；见 doc/TELEMETRY_DESIGN.md §2.1 */
export function resolveTelemetryState(config: Pick<AppConfig, "telemetry" | "eula">, lockedByEnv = isTelemetryDisabledByEnv()): TelemetryState {
    const telemetry = config.telemetry ?? {};
    const acceptedVersion = config.eula?.acceptedVersion;
    const consentPending = !!acceptedVersion && acceptedVersion !== EULA_VERSION;
    const endpoint = telemetry.endpoint?.trim() || DEFAULT_TELEMETRY_ENDPOINT;
    const retentionDays = telemetry.retentionDays ?? 30;
    if (lockedByEnv) {
        return {
            recording: false, errors: false, forwarding: false, forwardingConfigured: false,
            endpoint, retentionDays, lockedByEnv, consentPending, consentGiven: !!acceptedVersion,
        };
    }
    const forwardingConfigured = telemetry.forwarding === true;
    return {
        recording: telemetry.recording === true,
        errors: telemetry.errors !== false,
        // 外发必须建立在已同意协议之上：从未同意或待重新同意时都暂停
        forwarding: forwardingConfigured && !!acceptedVersion && !consentPending,
        forwardingConfigured,
        endpoint,
        retentionDays,
        lockedByEnv,
        consentPending,
        consentGiven: !!acceptedVersion,
    };
}

export function getTelemetryState(): TelemetryState {
    return resolveTelemetryState(getAppConfig());
}
