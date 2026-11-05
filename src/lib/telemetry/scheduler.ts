import "server-only";

import { createLogger } from "@/lib/logger";
import { purgeTelemetry } from "@/lib/telemetry/server";

const logger = createLogger("telemetry:scheduler");

const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let started = false;

/** 常驻进程中启动遥测的定时任务：启动时清理一次，之后每 6 小时清理 */
export function startTelemetryScheduler(): void {
    if (started) return;
    started = true;
    const purge = () => {
        purgeTelemetry().then((count) => {
            if (count > 0) logger.info({ count }, "Purged expired telemetry records");
        }).catch(() => undefined);
    };
    purge();
    setInterval(purge, PURGE_INTERVAL_MS).unref();
}
