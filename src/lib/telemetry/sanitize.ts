/**
 * 错误回报的脱敏与归一化（服务端写库前执行，见 doc/TELEMETRY_DESIGN.md §5.3–5.4）。
 * 纯函数，不依赖 Node 模块；脱敏后的 message、stack 仍可能残留业务文本，只保存在本地、永不外发。
 */

const MAX_MESSAGE = 500;
const MAX_STACK = 8000;
const MAX_PATH = 200;

/** 把 cuid、UUID、十六进制与长数字片段替换为 :id */
function maskIdSegment(segment: string): string {
    if (/^\d{3,}$/.test(segment)) return ":id";
    if (/^[0-9a-f]{8,}$/i.test(segment) && /\d/.test(segment)) return ":id";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ":id";
    if (/^c[a-z0-9]{20,}$/.test(segment)) return ":id";
    return segment;
}

/** 只保留 pathname，并把其中的 ID 片段替换为 :id */
export function normalizePath(input: unknown): string | null {
    if (typeof input !== "string" || !input) return null;
    let pathname = input;
    try {
        pathname = new URL(input, "http://localhost").pathname;
    } catch {
        return null;
    }
    const normalized = pathname.split("/").map((segment) => (segment ? maskIdSegment(segment) : segment)).join("/");
    return normalized.slice(0, MAX_PATH) || "/";
}

/** URL 去掉查询串与片段，只留协议、主机与路径 */
function stripUrlQuery(text: string): string {
    return text.replace(/\b(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/g, "$1");
}

/** 邮箱替换为 <email>，6 位以上数字替换为 <num>，URL 去掉查询串，截断到 500 字符 */
export function sanitizeMessage(input: unknown): string | null {
    if (typeof input !== "string" || !input) return null;
    return stripUrlQuery(input)
        .replace(/[^\s@<>()"']+@[^\s@<>()"']+\.[A-Za-z]{2,}/g, "<email>")
        .replace(/\d{6,}/g, "<num>")
        .slice(0, MAX_MESSAGE);
}

/** 栈帧中的地址只留 pathname（去掉协议、主机与查询串） */
function framePath(frame: string): string {
    return frame.replace(/\b(?:https?|webpack(?:-internal)?|file):\/\/\/?[^/\s)]*/g, "").replace(/\?[^\s:)]*/g, "");
}

/** 只保留 at … 帧（V8）或 fn@url 帧（Safari/Firefox），帧里只留 pathname，截断到 8000 字符 */
export function sanitizeStack(input: unknown): string | null {
    if (typeof input !== "string" || !input) return null;
    const frames = input.split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("at ") || /^[^\s@]*@\S+:\d+:\d+$/.test(line))
        .map(framePath);
    return frames.length ? frames.join("\n").slice(0, MAX_STACK) : null;
}

/** 堆栈首帧的稳定形式：去掉主机、查询串、行列号与构建产物 chunk 哈希，用于计算指纹 */
export function normalizedTopFrame(stack: unknown): string {
    const top = sanitizeStack(stack)?.split("\n")[0] ?? "";
    return top
        .replace(/:\d+(:\d+)?\)?$/, "")
        .replace(/\)$/, "")
        // 构建产物文件名中的哈希：page-3f2a9c1b.js、chunks/1234-abcd1234ef.js、_next/static/chunks/abc123def456.js
        .replace(/([./_-])[0-9a-f]{6,}(?=[./_-])/gi, "$1#")
        .replace(/\/\d+(?=[.-])/g, "/#");
}

/** UA 只保留浏览器大类、主版本与系统大类，如 "Chrome 140 / Android" */
export function summarizeUserAgent(input: unknown): string | null {
    if (typeof input !== "string" || !input) return null;
    const ua = input;
    const os = /Android/i.test(ua) ? "Android"
        : /iPhone|iPad|iPod/i.test(ua) ? "iOS"
        : /Windows/i.test(ua) ? "Windows"
        : /Mac OS X|Macintosh/i.test(ua) ? "macOS"
        : /Linux/i.test(ua) ? "Linux"
        : "Other";
    const browsers: Array<[string, RegExp]> = [
        ["Edge", /Edg(?:e|A|iOS)?\/(\d+)/],
        ["Electron", /Electron\/(\d+)/],
        ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/],
        ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
        ["Safari", /Version\/(\d+).*Safari/],
    ];
    for (const [name, pattern] of browsers) {
        const match = ua.match(pattern);
        if (match) return `${name} ${match[1]} / ${os}`;
    }
    return `Other / ${os}`;
}
