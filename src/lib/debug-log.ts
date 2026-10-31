/**
 * 调试日志：管理员开启调试模式后，在内存中记录所有级别（含 debug）的服务端日志，
 * 复现问题后可导出发给作者排查。
 *
 * - 状态与缓冲区挂在 globalThis 上，Next.js 各路由分包加载的模块副本共享同一份数据
 * - 记录前脱敏：API Key、密码、令牌等字段替换为 [REDACTED]，图片 data URL 只保留长度
 * - 缓冲区有条数和体积上限，超出后丢弃最早的记录；开启后超过时限自动关闭
 * - 只保存在内存中，服务重启后调试模式关闭、日志清空
 */

/** 调试模式最长开启时间，避免忘记关闭后持续占用内存 */
export const DEBUG_MODE_DURATION_MS = 24 * 60 * 60 * 1000;
/** 最多保留的日志条数 */
export const MAX_DEBUG_ENTRIES = 5000;
/** 缓冲区总体积上限（按 JSON 字符数估算） */
export const MAX_DEBUG_BYTES = 20 * 1024 * 1024;
/** 单个字符串最长保留的字符数 */
export const MAX_STRING_LENGTH = 10000;

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 100;
const REDACTED = '[REDACTED]';

/** 敏感字段名：API Key、密码、密钥、认证头、Cookie、各类令牌（不含 maxTokens 等用量字段） */
const SENSITIVE_KEY_PATTERN = /api[-_]?key|password|passwd|secret|authorization|cookie|credential|private[-_]?key|^(access|refresh|id|auth|api|bearer|session|csrf|setup)?[-_]?token$/i;

export interface DebugLogEntry {
    time: string;
    level: string;
    msg: string;
    [key: string]: unknown;
}

interface DebugLogState {
    enabledAt: number | null;
    entries: { entry: DebugLogEntry; size: number }[];
    totalSize: number;
    dropped: number;
}

export interface DebugLogStatus {
    enabled: boolean;
    enabledAt: string | null;
    expiresAt: string | null;
    entryCount: number;
    droppedCount: number;
}

const STATE_KEY = Symbol.for('wrong-notebook.debug-log');

function getState(): DebugLogState {
    const holder = globalThis as unknown as Record<symbol, DebugLogState | undefined>;
    let state = holder[STATE_KEY];
    if (!state) {
        state = { enabledAt: null, entries: [], totalSize: 0, dropped: 0 };
        holder[STATE_KEY] = state;
    }
    return state;
}

/** 调试模式是否开启；超过时限时自动关闭（保留已记录的日志供导出） */
export function isDebugModeEnabled(now: number = Date.now()): boolean {
    const state = getState();
    if (state.enabledAt === null) return false;
    if (now - state.enabledAt >= DEBUG_MODE_DURATION_MS) {
        state.enabledAt = null;
        return false;
    }
    return true;
}

/** 开启时清空上一轮日志，重新计时；关闭时保留日志，方便关闭后再导出 */
export function setDebugMode(enabled: boolean, now: number = Date.now()): DebugLogStatus {
    const state = getState();
    if (enabled) {
        state.enabledAt = now;
        state.entries = [];
        state.totalSize = 0;
        state.dropped = 0;
    } else {
        state.enabledAt = null;
    }
    return getDebugLogStatus(now);
}

export function clearDebugLogs(): void {
    const state = getState();
    state.entries = [];
    state.totalSize = 0;
    state.dropped = 0;
}

export function getDebugLogStatus(now: number = Date.now()): DebugLogStatus {
    const enabled = isDebugModeEnabled(now);
    const state = getState();
    return {
        enabled,
        enabledAt: state.enabledAt === null ? null : new Date(state.enabledAt).toISOString(),
        expiresAt: state.enabledAt === null ? null : new Date(state.enabledAt + DEBUG_MODE_DURATION_MS).toISOString(),
        entryCount: state.entries.length,
        droppedCount: state.dropped,
    };
}

export function getDebugLogEntries(): DebugLogEntry[] {
    return getState().entries.map(({ entry }) => entry);
}

/** 字符串内的密钥片段：Bearer 令牌、sk- 开头的 Key、URL 中的 key 参数 */
function redactString(value: string): string {
    let text = value
        .replace(/data:([\w.+-]+\/[\w.+-]+);base64,[A-Za-z0-9+/=]+/g, (match, mime: string) => `[data:${mime}, ${match.length} chars]`)
        .replace(/(Bearer\s+)[\w\-.~+/]+=*/gi, `$1${REDACTED}`)
        .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED)
        .replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s"']+/gi, `$1${REDACTED}`);
    if (text.length > MAX_STRING_LENGTH) {
        text = `${text.slice(0, MAX_STRING_LENGTH)}…[truncated ${text.length - MAX_STRING_LENGTH} chars]`;
    }
    return text;
}

/** 脱敏并裁剪任意值，结果可安全地 JSON 序列化 */
export function sanitizeForDebug(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return redactString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function' || typeof value === 'symbol') return String(value);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
        const result: Record<string, unknown> = { name: value.name, message: redactString(value.message) };
        if (value.stack) result.stack = redactString(value.stack);
        const extra = value as Error & { code?: unknown; status?: unknown; cause?: unknown };
        if (extra.code !== undefined) result.code = sanitizeForDebug(extra.code, depth + 1, seen);
        if (extra.status !== undefined) result.status = sanitizeForDebug(extra.status, depth + 1, seen);
        if (extra.cause !== undefined && depth < MAX_DEPTH) result.cause = sanitizeForDebug(extra.cause, depth + 1, seen);
        return result;
    }
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return '[Circular]';
    if (depth >= MAX_DEPTH) return '[Object]';
    seen.add(value);

    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForDebug(item, depth + 1, seen));
        if (value.length > MAX_ARRAY_ITEMS) items.push(`…[${value.length - MAX_ARRAY_ITEMS} more items]`);
        return items;
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        return `[Binary ${value.byteLength} bytes]`;
    }

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        result[key] = SENSITIVE_KEY_PATTERN.test(key) && item !== undefined && item !== null && item !== ''
            ? REDACTED
            : sanitizeForDebug(item, depth + 1, seen);
    }
    return result;
}

/** 写入一条调试日志；调试模式关闭时直接返回 */
export function recordDebugLog(level: string, context: Record<string, unknown>, message: string, time: Date = new Date()): void {
    if (!isDebugModeEnabled(time.getTime())) return;
    try {
        const entry = {
            ...(sanitizeForDebug(context) as Record<string, unknown>),
            time: time.toISOString(),
            level,
            msg: redactString(message),
        } satisfies DebugLogEntry;
        const size = JSON.stringify(entry).length;
        const state = getState();
        state.entries.push({ entry, size });
        state.totalSize += size;
        while (state.entries.length > MAX_DEBUG_ENTRIES || (state.totalSize > MAX_DEBUG_BYTES && state.entries.length > 1)) {
            const removed = state.entries.shift();
            if (!removed) break;
            state.totalSize -= removed.size;
            state.dropped += 1;
        }
    } catch {
        // 调试日志不能影响正常业务
    }
}
