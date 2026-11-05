import "server-only";

import { createLogger } from "@/lib/logger";
import { flushOutbox } from "@/lib/telemetry/outbox";
import { purgeTelemetry } from "@/lib/telemetry/server";

const logger = createLogger("telemetry:scheduler");

const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 外发队列每 10 分钟检查一次；真正发送的条件见 outbox.ts */
const FLUSH_CHECK_INTERVAL_MS = 10 * 60 * 1000;
/** 启动后等 1 分钟再检查，避开启动时的迁移与初始化 */
const FIRST_FLUSH_DELAY_MS = 60 * 1000;

let started = false;

/** 常驻进程中启动遥测的定时任务：启动时及每 6 小时清理；启动 1 分钟后开始检查外发队列 */
export function startTelemetryScheduler(): void {
    if (started) return;
    started = true;
    const purge = () => {
        purgeTelemetry().then((count) => {
            if (count > 0) logger.info({ count }, "Purged expired telemetry records");
        }).catch(() => undefined);
    };
    const flush = () => {
        flushOutbox().catch(() => undefined);
    };
    purge();
    setInterval(purge, PURGE_INTERVAL_MS).unref();
    setTimeout(() => {
        flush();
        setInterval(flush, FLUSH_CHECK_INTERVAL_MS).unref();
    }, FIRST_FLUSH_DELAY_MS).unref();
}
