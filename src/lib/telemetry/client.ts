/**
 * 浏览器端遥测门面：不等待结果、失败静默，不预取开关状态（服务端关闭时返回 202 不写库）。
 * 不用 cookie、不生成会话 ID；只用 sessionStorage 做会话内去重。见 doc/TELEMETRY_DESIGN.md §3.2
 */
import { getAndroidAppBridge } from "@/lib/android-app";
import type { ClientEventName, TelemetryEventPayloads } from "@/lib/telemetry/schema";

const ENDPOINT = "/api/telemetry";
const SESSION_PREFIX = "wn-telemetry:";

function send(body: object): void {
    try {
        const text = JSON.stringify(body);
        if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
            // text/plain 属于简单类型，旧版 Chrome 对 application/json 的 Beacon 会直接抛错；服务端按文本解析
            if (navigator.sendBeacon(ENDPOINT, new Blob([text], { type: "text/plain;charset=UTF-8" }))) return;
        }
        if (typeof fetch === "function") {
            fetch(ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: text,
                keepalive: true,
                credentials: "same-origin",
            }).catch(() => undefined);
        }
    } catch {
        // 遥测失败不影响页面
    }
}

/** 会话内只做一次：返回 true 表示本次是第一次（sessionStorage 不可用时也返回 true） */
export function firstInSession(key: string): boolean {
    try {
        const storageKey = SESSION_PREFIX + key;
        if (sessionStorage.getItem(storageKey)) return false;
        sessionStorage.setItem(storageKey, "1");
    } catch {
        // 隐私模式等场景无法使用 sessionStorage 时不去重
    }
    return true;
}

export function trackEvent<N extends ClientEventName>(name: N, payload?: TelemetryEventPayloads[N]): void {
    send({ t: "event", name, ...(payload ? { payload } : {}) });
}

/** 当前客户端形态：安卓 App、桌面版、安装的 PWA 或普通浏览器 */
export function detectClient(): TelemetryEventPayloads["app_opened"]["client"] {
    if (typeof window === "undefined") return "browser";
    if (getAndroidAppBridge()) return "android";
    if (/Electron\//.test(navigator.userAgent)) return "desktop";
    try {
        if (window.matchMedia?.("(display-mode: standalone)").matches) return "pwa";
    } catch {
        // 旧版浏览器不支持 matchMedia 时按普通浏览器处理
    }
    return "browser";
}

/** 每个浏览器会话记录一次 app_opened */
export function trackAppOpened(): void {
    if (firstInSession("app_opened")) trackEvent("app_opened", { client: detectClient() });
}

/** 会话内去重用的轻量哈希（不是指纹本身，指纹由服务端计算） */
function quickHash(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    return (hash >>> 0).toString(36);
}

let reporting = false;

/** 上报浏览器错误；同一错误每个会话只报一次，上报过程中再出错不会重入 */
export function trackError(input: { kind: "client" | "boundary"; scope: string; error: unknown }): void {
    if (reporting) return;
    reporting = true;
    try {
        const error = input.error instanceof Error ? input.error : null;
        const name = error?.name || "Error";
        const message = error?.message ?? (typeof input.error === "string" ? input.error : String(input.error ?? ""));
        const stack = error?.stack ?? "";
        const firstFrame = stack.split("\n").find((line) => /^\s*at |@/.test(line)) ?? message;
        if (!firstInSession(`error:${quickHash([input.kind, input.scope, name, firstFrame].join("|"))}`)) return;
        send({
            t: "error",
            kind: input.kind,
            scope: input.scope,
            name: name.slice(0, 200),
            message: message.slice(0, 2000),
            stack: stack.slice(0, 8000),
            path: typeof location !== "undefined" ? location.pathname : undefined,
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : undefined,
        });
    } catch {
        // 忽略
    } finally {
        reporting = false;
    }
}
