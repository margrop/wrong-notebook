import "server-only";

import { getAppConfig } from "@/lib/config";
import { durationBucket } from "@/lib/telemetry/schema";
import { recordEvent } from "@/lib/telemetry/server";
import type { AppConfig } from "@/lib/config";

/**
 * 服务端埋点助手：AI 调用的成败与耗时区间。事件异步写入，不等待、不影响业务结果；
 * 遥测关闭或 payload 不合法时 recordEvent 自动跳过
 */

/** 读取失败时返回 null，对应事件因 payload 不合法被跳过，不影响 AI 调用 */
function currentProvider(): AppConfig["aiProvider"] | null {
    try {
        return getAppConfig().aiProvider;
    } catch {
        return null;
    }
}

/** 题目识别：记录开始，以及成功或失败和耗时区间 */
export async function trackAnalyze<T>(run: () => Promise<T>): Promise<T> {
    const provider = currentProvider();
    void recordEvent("ai_analyze_started", { provider: provider as AppConfig["aiProvider"] });
    const started = Date.now();
    const finish = (ok: boolean) => void recordEvent("ai_analyze_result", { ok, provider: provider as AppConfig["aiProvider"], duration: durationBucket(Date.now() - started) });
    try {
        const result = await run();
        finish(true);
        return result;
    } catch (error) {
        finish(false);
        throw error;
    }
}

/** 记录一次 AI 调用的成败；payload 由调用方按结果生成 */
async function trackOutcome<T>(run: () => Promise<T>, record: (ok: boolean) => void): Promise<T> {
    try {
        const result = await run();
        record(true);
        return result;
    } catch (error) {
        record(false);
        throw error;
    }
}

export function trackReanswer<T>(run: () => Promise<T>): Promise<T> {
    const provider = currentProvider();
    return trackOutcome(run, (ok) => void recordEvent("ai_reanswer", { ok, provider: provider as AppConfig["aiProvider"] }));
}

/** 练习批改：一次批改一道题 */
export function trackPracticeGrading<T>(run: () => Promise<T>): Promise<T> {
    return trackOutcome(run, (ok) => void recordEvent("ai_practice_grading", { ok, count: "1" }));
}
