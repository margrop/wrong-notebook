/**
 * 耗时请求的响应暂存，供请求被浏览器中断后取回。
 *
 * 部分浏览器（如 iPhone 上的 Safari）会在服务端返回前中断等待较久的请求，fetch 抛出网络错误，
 * 而服务端仍会继续执行（AI 生成、保存等）。前端为这类请求附带随机的请求编号（X-Request-Id），
 * 服务端把最终响应按编号暂存在内存中，前端断线后通过 GET /api/requests/:id 轮询取回原本的响应。
 *
 * 只保存在当前进程内存中（生产环境为单个容器），服务重启后清空；请求编号由前端随机生成，只有发起请求的页面知道。
 */
import { createLogger } from "@/lib/logger";

const logger = createLogger('recoverable-response');

export const REQUEST_ID_HEADER = 'x-request-id';

/** 请求结束后响应保留的时长 */
export const RESPONSE_TTL_MS = 15 * 60 * 1000;
/** 进行中的请求最长保留时长（超过后视为丢失） */
const RUNNING_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 200;
/** 单个响应最多暂存的字符数，超出时不保存，前端按请求失败处理 */
const MAX_BODY_LENGTH = 5_000_000;

const REQUEST_ID_PATTERN = /^[a-f0-9]{32}$/;

export type StoredResponse =
    | { state: 'running' }
    | { state: 'done'; status: number; body: unknown };

interface Entry {
    startedAt: number;
    finishedAt: number | null;
    status: number;
    body: unknown;
}

const store = globalThis as typeof globalThis & { __recoverableResponses?: Map<string, Entry> };
const entries: Map<string, Entry> = store.__recoverableResponses ??= new Map();

function prune(now: number) {
    for (const [id, entry] of entries) {
        const expired = entry.finishedAt !== null
            ? now - entry.finishedAt > RESPONSE_TTL_MS
            : now - entry.startedAt > RUNNING_TTL_MS;
        if (expired) entries.delete(id);
    }
    // 超出上限时删除最早登记的
    for (const id of entries.keys()) {
        if (entries.size <= MAX_ENTRIES) break;
        entries.delete(id);
    }
}

/** 校验前端传来的请求编号（32 位十六进制），无效时返回 null */
export function parseRequestId(value: string | null | undefined): string | null {
    const id = value?.trim().toLowerCase();
    return id && REQUEST_ID_PATTERN.test(id) ? id : null;
}

async function readBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text.length > MAX_BODY_LENGTH) throw new Error('RESPONSE_TOO_LARGE');
    if (!text) return null;
    if ((response.headers.get('content-type') ?? '').includes('application/json')) return JSON.parse(text);
    return text;
}

/**
 * 包装路由处理函数：请求带有请求编号时，暂存处理结果（状态码与响应内容）供断线后取回
 */
export function withRecoverableResponse<R extends Request, A extends unknown[]>(handler: (req: R, ...args: A) => Promise<Response>) {
    return async (req: R, ...args: A): Promise<Response> => {
        const id = parseRequestId(req.headers.get(REQUEST_ID_HEADER));
        if (!id) return handler(req, ...args);

        const now = Date.now();
        prune(now);
        const entry: Entry = { startedAt: now, finishedAt: null, status: 0, body: null };
        entries.set(id, entry);
        try {
            const response = await handler(req, ...args);
            try {
                entry.body = await readBody(response.clone());
                entry.status = response.status;
                entry.finishedAt = Date.now();
            } catch (error) {
                entries.delete(id);
                logger.warn({ requestId: id, error: error instanceof Error ? error.message : String(error) }, 'Response not stored for recovery');
            }
            return response;
        } catch (error) {
            entries.delete(id);
            throw error;
        }
    };
}

/** 按请求编号查询：进行中、已结束（含响应），或不存在（请求没有到达服务端、已过期或服务重启） */
export function getStoredResponse(id: string): StoredResponse | null {
    prune(Date.now());
    const entry = entries.get(id);
    if (!entry) return null;
    return entry.finishedAt === null ? { state: 'running' } : { state: 'done', status: entry.status, body: entry.body };
}

/** 仅供测试：清空暂存 */
export function resetRecoverableResponsesForTest(): void {
    entries.clear();
}
