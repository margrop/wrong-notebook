import "server-only";

import { getAppConfig } from "@/lib/config";
import { EULA_VERSION } from "@/lib/eula";
import { prisma } from "@/lib/prisma";
import { getOutboxRuntime } from "@/lib/telemetry/outbox";
import { DEFAULT_TELEMETRY_ENDPOINT, getTelemetryState } from "@/lib/telemetry/state";
import type { TelemetryAdminResponse, TelemetryAdminStatus } from "@/lib/telemetry/types";

const RECENT_LIMIT = 20;

/** 局域网与本机地址允许 http，其余必须 https */
function isPrivateHost(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".lan") || host === "::1") return true;
    const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4) {
        const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
        return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
    }
    return /^f[cd][0-9a-f]{2}:/.test(host);
}

/** 自建收集服务地址：只允许 https，局域网地址可以用 http；不允许携带账号密码 */
export function isValidTelemetryEndpoint(value: string): boolean {
    if (value === "") return true;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && isPrivateHost(url.hostname);
}

export async function getTelemetryAdminStatus(): Promise<TelemetryAdminStatus> {
    const config = getAppConfig();
    const state = getTelemetryState();
    const telemetry = config.telemetry ?? {};
    const pendingWhere = { forwardedAt: null };
    const [pendingEvents, pendingErrors] = await Promise.all([
        prisma.telemetryEvent.count({ where: pendingWhere }),
        prisma.telemetryError.count({ where: pendingWhere }),
    ]);
    return {
        recording: state.recording,
        errors: state.errors,
        forwarding: state.forwardingConfigured,
        forwardingActive: state.forwarding,
        endpoint: telemetry.endpoint ?? "",
        defaultEndpoint: DEFAULT_TELEMETRY_ENDPOINT,
        retentionDays: state.retentionDays,
        lockedByEnv: state.lockedByEnv,
        consentPending: state.consentPending,
        eula: { current: EULA_VERSION, acceptedVersion: config.eula?.acceptedVersion ?? null, acceptedAt: config.eula?.acceptedAt ?? null },
        showNotice: !state.lockedByEnv && !state.consentGiven && !telemetry.forwarding && !telemetry.noticeDismissedAt,
        pending: pendingEvents + pendingErrors,
        lastFlushAt: telemetry.lastFlushAt ?? null,
        lastAttempt: getOutboxRuntime().lastAttempt,
    };
}

/** 状态 + 最近 20 条事件和错误（“本实例收集了什么”） */
export async function getTelemetryAdminResponse(): Promise<TelemetryAdminResponse> {
    const [status, events, errors] = await Promise.all([
        getTelemetryAdminStatus(),
        prisma.telemetryEvent.findMany({ orderBy: { createdAt: "desc" }, take: RECENT_LIMIT }),
        prisma.telemetryError.findMany({ orderBy: { createdAt: "desc" }, take: RECENT_LIMIT }),
    ]);
    return {
        ...status,
        events: events.map((event) => ({
            id: event.id, name: event.name, payload: event.payload,
            createdAt: event.createdAt.toISOString(), forwardedAt: event.forwardedAt?.toISOString() ?? null,
        })),
        errorRecords: errors.map((error) => ({
            id: error.id, kind: error.kind, scope: error.scope, name: error.name, fingerprint: error.fingerprint,
            message: error.message, path: error.path,
            createdAt: error.createdAt.toISOString(), forwardedAt: error.forwardedAt?.toISOString() ?? null,
        })),
    };
}
