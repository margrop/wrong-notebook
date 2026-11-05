/**
 * 浏览器内核版本检测。
 *
 * 界面样式由 Tailwind CSS 4 生成，要求 Chromium 111 及以上（独立的 translate/scale 属性、
 * color-mix 透明色等）。安卓 App 使用系统自带的 Android System WebView，
 * 没有 Google Play 的手机常停留在出厂版本（如 Android 13 的 103），部分界面会错位或颜色异常。
 */

/** Tailwind CSS 4 支持的最低 Chromium 主版本 */
export const MIN_CHROMIUM_VERSION = 111;

export interface OutdatedEngine {
    /** webview：安卓 App 或其他应用内嵌的系统 WebView；browser：Chromium 内核浏览器 */
    kind: "webview" | "browser";
    version: number;
}

/** 根据 User-Agent 判断 Chromium 内核是否过旧；非 Chromium 内核或无法识别时返回 null */
export function detectOutdatedEngine(userAgent: string): OutdatedEngine | null {
    const match = /\bChrome\/(\d+)\./.exec(userAgent);
    if (!match) return null;
    const version = Number(match[1]);
    if (version >= MIN_CHROMIUM_VERSION) return null;
    const isWebView = /; wv\)/.test(userAgent) || userAgent.includes("WrongNotebookAndroid/");
    return { kind: isWebView ? "webview" : "browser", version };
}
