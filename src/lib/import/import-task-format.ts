import type { ImportTaskTimings } from "@/lib/import/import-task-types";
import { CLIENT_TIMING_KEYS, SERVER_TIMING_KEYS } from "@/lib/import/import-task-types";

export type TimingStage = typeof CLIENT_TIMING_KEYS[number] | typeof SERVER_TIMING_KEYS[number];

/** 毫秒转为「1.2 秒」「1:05」式的简短时长 */
export function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return "-";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
    const whole = Math.round(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** 按流程顺序列出已记录的阶段耗时 */
export function listTimingStages(timings: ImportTaskTimings | undefined): Array<{ stage: TimingStage; ms: number }> {
    const stages: Array<{ stage: TimingStage; ms: number }> = [];
    for (const stage of CLIENT_TIMING_KEYS) {
        const ms = timings?.client?.[stage];
        if (typeof ms === "number") stages.push({ stage, ms });
    }
    for (const stage of SERVER_TIMING_KEYS) {
        const ms = timings?.server?.[stage];
        if (typeof ms === "number") stages.push({ stage, ms });
    }
    return stages;
}
