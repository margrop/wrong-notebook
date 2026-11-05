import "server-only";

import { createHash } from "node:crypto";
import { getAppVersion } from "@/lib/app-version";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { normalizeErrorName, parseEventPayload } from "@/lib/telemetry/schema";
import { normalizedTopFrame, normalizePath, sanitizeMessage, sanitizeStack, summarizeUserAgent } from "@/lib/telemetry/sanitize";
import { getTelemetryState } from "@/lib/telemetry/state";
import type { TelemetryErrorKind, TelemetryEventName, TelemetryEventPayloads } from "@/lib/telemetry/schema";
import type { TelemetryState } from "@/lib/telemetry/state";

export { DEFAULT_TELEMETRY_ENDPOINT, getTelemetryState } from "@/lib/telemetry/state";

const logger = createLogger("telemetry");

/** 只为外发保存、超过这个天数仍未发出的记录被清理；收集服务也只接受 7 天内的日期 */
export const OUTBOX_MAX_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 写入规则（§2.2）：两个开关都关时不写；local 表示是否作为本地记录保留 */
export function writeMode(state: TelemetryState): { write: boolean; local: boolean } {
    return { write: state.recording || state.forwarding, local: state.recording };
}

/**
 * 记录一条服务端事件，payload 不合法或遥测关闭时不写；绝不抛错，不影响业务流程。
 * 返回是否写入，便于调用方与测试判断
 */
export async function recordEvent<N extends TelemetryEventName>(name: N, payload?: TelemetryEventPayloads[N], state?: TelemetryState): Promise<boolean> {
    try {
        // 读取开关也放在 try 内：调用方常以 void 方式调用，任何异常都不能变成未处理的拒绝
        const mode = writeMode(state ?? getTelemetryState());
        if (!mode.write) return false;
        const parsed = parseEventPayload(name, payload);
        if (!parsed) {
            logger.warn({ name }, "Dropped telemetry event with invalid payload");
            return false;
        }
        await prisma.telemetryEvent.create({
            data: { name, payload: JSON.stringify(parsed), version: getAppVersion(), local: mode.local },
        });
        return true;
    } catch (error) {
        logger.warn({ error }, "Failed to record telemetry event");
        return false;
    }
}

export interface TelemetryErrorInput {
    kind: TelemetryErrorKind;
    scope: string;
    name: string;
    message?: string | null;
    stack?: string | null;
    path?: string | null;
    userAgent?: string | null;
}

/** 指纹 = sha256(kind + scope + name + 归一化后的堆栈首帧) 前 16 位；同一个 bug 在不同实例、不同构建下保持一致 */
export function errorFingerprint(input: Pick<TelemetryErrorInput, "kind" | "scope" | "name" | "stack">): string {
    return createHash("sha256")
        .update([input.kind, input.scope, input.name, normalizedTopFrame(input.stack)].join("\n"))
        .digest("hex")
        .slice(0, 16);
}

/** 服务端同一指纹 1 分钟内只写一行；最多记 500 个指纹 */
const DEDUPE_WINDOW_MS = 60_000;
const DEDUPE_MAX_KEYS = 500;
const recentFingerprints = new Map<string, number>();

function isDuplicate(fingerprint: string, now: number): boolean {
    const last = recentFingerprints.get(fingerprint);
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return true;
    recentFingerprints.delete(fingerprint);
    if (recentFingerprints.size >= DEDUPE_MAX_KEYS) {
        const oldest = recentFingerprints.keys().next().value;
        if (oldest !== undefined) recentFingerprints.delete(oldest);
    }
    recentFingerprints.set(fingerprint, now);
    return false;
}

/** 测试用：清空去重记录 */
export function resetErrorDedupe(): void {
    recentFingerprints.clear();
}

/**
 * 脱敏后写入一条错误记录。只开外发时不保存 message、stack、path、UA。
 * 返回指纹；未写入（关闭、去重、出错）时返回 null
 */
export async function writeTelemetryError(input: TelemetryErrorInput, state: TelemetryState = getTelemetryState()): Promise<string | null> {
    const mode = writeMode(state);
    if (!mode.write || !state.errors) return null;
    const name = normalizeErrorName(input.name);
    const fingerprint = errorFingerprint({ ...input, name });
    if (isDuplicate(fingerprint, Date.now())) return null;
    await prisma.telemetryError.create({
        data: {
            kind: input.kind,
            scope: input.scope,
            name,
            fingerprint,
            version: getAppVersion(),
            local: mode.local,
            ...(mode.local ? {
                message: sanitizeMessage(input.message),
                stack: sanitizeStack(input.stack),
                path: normalizePath(input.path),
                userAgent: summarizeUserAgent(input.userAgent),
            } : {}),
        },
    });
    return fingerprint;
}

/** 上报一个服务端错误（API 5xx）；绝不抛错 */
export async function reportServerError(scope: string, error: unknown): Promise<void> {
    try {
        const err = error instanceof Error ? error : null;
        await writeTelemetryError({
            kind: "server",
            scope,
            name: err?.name ?? "Error",
            message: err?.message ?? (typeof error === "string" ? error : null),
            stack: err?.stack ?? null,
        });
    } catch (failure) {
        // 遥测自身出错只记日志，不再上报，防止递归
        logger.warn({ error: failure }, "Failed to record server error");
    }
}

/**
 * 清理（§3.6）：本地记录超过保留天数的删除；只为外发保存、超过 7 天仍未发出的删除；
 * 外发后不再需要的非本地记录也删除。与开关状态无关。返回删除条数
 */
export async function purgeTelemetry(now = new Date(), state: TelemetryState = getTelemetryState()): Promise<number> {
    const localCutoff = new Date(now.getTime() - state.retentionDays * DAY_MS);
    const outboxCutoff = new Date(now.getTime() - OUTBOX_MAX_AGE_DAYS * DAY_MS);
    const where = {
        OR: [
            { local: true, createdAt: { lt: localCutoff } },
            { local: false, createdAt: { lt: outboxCutoff } },
            { local: false, forwardedAt: { not: null } },
        ],
    };
    try {
        const [events, errors] = await prisma.$transaction([
            prisma.telemetryEvent.deleteMany({ where }),
            prisma.telemetryError.deleteMany({ where }),
        ]);
        return events.count + errors.count;
    } catch (error) {
        logger.warn({ error }, "Failed to purge telemetry");
        return 0;
    }
}

/** 管理员“立即清空”：删除全部遥测记录（含待发） */
export async function clearTelemetry(): Promise<number> {
    const [events, errors] = await prisma.$transaction([
        prisma.telemetryEvent.deleteMany(),
        prisma.telemetryError.deleteMany(),
    ]);
    return events.count + errors.count;
}
