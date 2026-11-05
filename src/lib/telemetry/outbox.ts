import "server-only";

import { getAppVersion } from "@/lib/app-version";
import { getAppConfig, updateAppConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { MAX_BATCH_ITEMS, utcDay } from "@/lib/telemetry/ingest-contract";
import { TELEMETRY_PLATFORMS, TELEMETRY_SCHEMA_VERSION } from "@/lib/telemetry/schema";
import { OUTBOX_MAX_AGE_DAYS, recordEvent } from "@/lib/telemetry/server";
import { getTelemetryState } from "@/lib/telemetry/state";
import type { TelemetryPlatform } from "@/lib/telemetry/schema";

/**
 * 外发队列（doc/TELEMETRY_DESIGN.md §3.5）：本地表兼作待发队列，
 * 距上次成功发送满 6 小时或待发满 100 条时，按协议 v1 批量 POST 到收集服务。
 * 失败不标记、下一轮重试；超过 7 天未发出的由清理任务删除。遵守服务端的退避与停用指令
 */

const logger = createLogger("telemetry:outbox");

const HOUR_MS = 60 * 60 * 1000;
/** 默认发送间隔；服务端下发的 minIntervalSec 只能调大 */
export const DEFAULT_FLUSH_INTERVAL_MS = 6 * HOUR_MS;
/** 发送失败（网络、5xx）后的等待时间，避免收集服务故障时每轮都重试 */
const FAILURE_BACKOFF_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const DAY_MS = 24 * HOUR_MS;

/** 进程内的退避状态：重启后清零（410 停发只持续到重启） */
interface OutboxRuntime {
    stopped: boolean;
    nextAllowedAt: number;
    intervalMs: number;
    running: boolean;
    /** 最近一次真正尝试发送的结果，供管理员面板显示 */
    lastAttempt: { at: string; status: "sent" | "failed" | "stopped"; httpStatus?: number } | null;
}

const initialRuntime = (): OutboxRuntime => ({
    stopped: false, nextAllowedAt: 0, intervalMs: DEFAULT_FLUSH_INTERVAL_MS, running: false, lastAttempt: null,
});
const runtime: OutboxRuntime = initialRuntime();

/** 测试用：重置进程内状态 */
export function resetOutboxRuntime(): void {
    Object.assign(runtime, initialRuntime());
}

export function getOutboxRuntime(): Readonly<OutboxRuntime> {
    return { ...runtime };
}

/** 部署形态：由各安装包启动器注入 WN_PLATFORM，缺省 other */
export function telemetryPlatform(): TelemetryPlatform {
    const value = process.env.WN_PLATFORM?.trim().toLowerCase();
    return (TELEMETRY_PLATFORMS as readonly string[]).includes(value ?? "") ? value as TelemetryPlatform : "other";
}

/** 当前 AI 服务商是否已配置（只看是否填了 Key 或完成登录，不外发任何配置内容） */
function isAiConfigured(): boolean {
    const config = getAppConfig();
    switch (config.aiProvider) {
        case "openai":
            return !!config.openai?.instances?.some((instance) => instance.id === config.openai?.activeInstanceId && instance.apiKey);
        case "gemini":
            return !!config.gemini?.apiKey;
        case "azure":
            return !!config.azure?.apiKey && !!config.azure?.endpoint;
        case "anthropic":
            return !!config.anthropic?.apiKey;
        case "minimax-code":
            return true;
        default:
            return !!config[config.aiProvider]?.apiKey;
    }
}

/** 每个 UTC 日第一次外发前写一条 instance_alive（用于统计日活实例，不需要实例 ID） */
async function ensureInstanceAlive(now: Date): Promise<void> {
    const dayStart = new Date(`${utcDay(now)}T00:00:00.000Z`);
    const lastFlushAt = getAppConfig().telemetry?.lastFlushAt;
    if (lastFlushAt && utcDay(new Date(lastFlushAt)) === utcDay(now)) return;
    const existing = await prisma.telemetryEvent.count({ where: { name: "instance_alive", createdAt: { gte: dayStart } } });
    if (existing > 0) return;
    await recordEvent("instance_alive", { platform: telemetryPlatform(), aiConfigured: isAiConfigured() });
}

interface OutboxRecord {
    id: string;
    kind: "event" | "error";
    local: boolean;
    version: string;
    createdAt: Date;
    item: Record<string, unknown>;
}

/** 取最早的一批待发记录（7 天内），同一批只含一个应用版本 */
async function loadBatch(now: Date): Promise<OutboxRecord[]> {
    const where = { forwardedAt: null, createdAt: { gte: new Date(now.getTime() - OUTBOX_MAX_AGE_DAYS * DAY_MS) } };
    const [events, errors] = await Promise.all([
        prisma.telemetryEvent.findMany({ where, orderBy: { createdAt: "asc" }, take: MAX_BATCH_ITEMS }),
        prisma.telemetryError.findMany({ where, orderBy: { createdAt: "asc" }, take: MAX_BATCH_ITEMS }),
    ]);
    const records: OutboxRecord[] = [
        ...events.map((event) => {
            let payload: unknown = null;
            try {
                payload = event.payload ? JSON.parse(event.payload) : null;
            } catch {
                payload = null;
            }
            const item: Record<string, unknown> = { t: "event", day: utcDay(event.createdAt), name: event.name };
            if (payload && typeof payload === "object" && Object.keys(payload).length > 0) item.payload = payload;
            return { id: event.id, kind: "event" as const, local: event.local, version: event.version, createdAt: event.createdAt, item };
        }),
        ...errors.map((error) => ({
            id: error.id, kind: "error" as const, local: error.local, version: error.version, createdAt: error.createdAt,
            // 只外发类别与指纹；message、stack、path、UA 永不外发
            item: { t: "error", day: utcDay(error.createdAt), kind: error.kind, scope: error.scope, name: error.name, fingerprint: error.fingerprint },
        })),
    ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (records.length === 0) return [];
    const version = records[0].version;
    return records.filter((record) => record.version === version).slice(0, MAX_BATCH_ITEMS);
}

/** 发送成功：本地记录标记为已发，只为外发保存的记录直接删除 */
async function markSent(records: OutboxRecord[], now: Date): Promise<void> {
    const ids = (kind: OutboxRecord["kind"], local: boolean) => records.filter((r) => r.kind === kind && r.local === local).map((r) => r.id);
    await prisma.$transaction([
        prisma.telemetryEvent.updateMany({ where: { id: { in: ids("event", true) } }, data: { forwardedAt: now } }),
        prisma.telemetryEvent.deleteMany({ where: { id: { in: ids("event", false) } } }),
        prisma.telemetryError.updateMany({ where: { id: { in: ids("error", true) } }, data: { forwardedAt: now } }),
        prisma.telemetryError.deleteMany({ where: { id: { in: ids("error", false) } } }),
    ]);
}

function parseRetryAfter(value: string | null): number | null {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** 应用服务端退避指令：retryAfterSec 推迟下一轮，minIntervalSec 只能把间隔调大到默认值以上 */
function applyControl(body: unknown, now: number): void {
    if (!body || typeof body !== "object") return;
    const { retryAfterSec, minIntervalSec } = body as { retryAfterSec?: unknown; minIntervalSec?: unknown };
    if (typeof retryAfterSec === "number" && retryAfterSec > 0) {
        runtime.nextAllowedAt = Math.max(runtime.nextAllowedAt, now + retryAfterSec * 1000);
    }
    if (typeof minIntervalSec === "number" && Number.isFinite(minIntervalSec)) {
        runtime.intervalMs = Math.max(DEFAULT_FLUSH_INTERVAL_MS, minIntervalSec * 1000);
    }
}

export type FlushResult =
    | { sent: number; status: "sent"; accepted: number; rejected: number }
    | { sent: 0; status: "disabled" | "stopped" | "backoff" | "not-due" | "empty" | "busy" | "failed"; httpStatus?: number };

/**
 * 检查并在需要时发送一批。force=true 时跳过“6 小时或满 100 条”的条件（仍遵守停用与退避）。
 * 绝不抛错
 */
export async function flushOutbox(options: { now?: Date; force?: boolean; fetchImpl?: typeof fetch } = {}): Promise<FlushResult> {
    const now = options.now ?? new Date();
    const doFetch = options.fetchImpl ?? fetch;
    const state = getTelemetryState();
    if (!state.forwarding) return { sent: 0, status: "disabled" };
    if (runtime.stopped) return { sent: 0, status: "stopped" };
    if (now.getTime() < runtime.nextAllowedAt) return { sent: 0, status: "backoff" };
    if (runtime.running) return { sent: 0, status: "busy" };
    runtime.running = true;
    try {
        const lastFlushAt = getAppConfig().telemetry?.lastFlushAt;
        const since = lastFlushAt ? now.getTime() - new Date(lastFlushAt).getTime() : Infinity;
        const pendingWhere = { forwardedAt: null };
        const pending = await prisma.telemetryEvent.count({ where: pendingWhere }) + await prisma.telemetryError.count({ where: pendingWhere });
        if (!options.force && since < runtime.intervalMs && pending < MAX_BATCH_ITEMS) return { sent: 0, status: "not-due" };

        await ensureInstanceAlive(now);
        const records = await loadBatch(now);
        if (records.length === 0) return { sent: 0, status: "empty" };

        let response: Response;
        try {
            response = await doFetch(state.endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json", "User-Agent": `wrong-notebook/${getAppVersion()}` },
                body: JSON.stringify({
                    schema: TELEMETRY_SCHEMA_VERSION,
                    app: "wrong-notebook",
                    version: records[0].version,
                    items: records.map((record) => record.item),
                }),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (error) {
            runtime.nextAllowedAt = now.getTime() + FAILURE_BACKOFF_MS;
            runtime.lastAttempt = { at: now.toISOString(), status: "failed" };
            logger.warn({ error }, "Telemetry flush failed");
            return { sent: 0, status: "failed" };
        }

        if (response.status === 410) {
            // 收集服务停用了本协议或版本：本进程停止外发直到重启
            runtime.stopped = true;
            runtime.lastAttempt = { at: now.toISOString(), status: "stopped", httpStatus: 410 };
            logger.warn("Telemetry collection disabled for this version; forwarding stopped until restart");
            return { sent: 0, status: "stopped", httpStatus: 410 };
        }
        if (!response.ok) {
            const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
            runtime.nextAllowedAt = now.getTime() + (retryAfter ? retryAfter * 1000 : FAILURE_BACKOFF_MS);
            runtime.lastAttempt = { at: now.toISOString(), status: "failed", httpStatus: response.status };
            logger.warn({ status: response.status }, "Telemetry flush rejected");
            return { sent: 0, status: "failed", httpStatus: response.status };
        }

        const body: unknown = await response.json().catch(() => null);
        await markSent(records, now);
        updateAppConfig({ telemetry: { lastFlushAt: now.toISOString() } });
        applyControl(body, now.getTime());
        runtime.lastAttempt = { at: now.toISOString(), status: "sent", httpStatus: response.status };
        const { accepted = records.length, rejected = 0 } = (body ?? {}) as { accepted?: number; rejected?: number };
        logger.info({ sent: records.length, accepted, rejected }, "Telemetry batch forwarded");
        return { sent: records.length, status: "sent", accepted, rejected };
    } catch (error) {
        logger.warn({ error }, "Telemetry flush error");
        return { sent: 0, status: "failed" };
    } finally {
        runtime.running = false;
    }
}
