import { toast } from "@/lib/feedback";
import { AI_LIMIT_MESSAGES, isAiLimitCode } from "@/lib/ai-limit-message";
import { isAiConsentRequired, requestAiConsent } from "@/lib/ai-consent";

type RequestOptions = RequestInit & {
    params?: Record<string, string>;
    timeout?: number; // 超时时间（毫秒），默认 60000
    /**
     * 耗时请求（AI 生成等）设为 true：附带请求编号，请求被浏览器中断（如 iPhone 上的 Safari 等待较久时）后
     * 改为轮询 /api/requests/:id 取回服务端的响应，对应路由需用 withRecoverableResponse 包装。
     * requestId 允许调用方指定请求编号（32 位十六进制）：刷新页面后用同一编号轮询 /api/requests/:id
     * 取回中断前的响应；不指定时自动生成随机编号
     */
    recoverable?: boolean;
    /** 仅 recoverable 时生效：调用方指定的请求编号（32 位十六进制） */
    requestId?: string;
};

export class ApiError extends Error {
    constructor(public status: number, public statusText: string, public data: unknown) {
        super(`API Error: ${status} ${statusText}`);
        this.name = 'ApiError';
    }
}

/**
 * AI 额度用完（每日次数上限或额度不足）时统一提示，各个 AI 按钮无需单独处理；
 * 语言与界面一致（LanguageContext 保存在 localStorage 中）。
 */
function notifyAiDailyLimit(data: unknown) {
    if (typeof data !== 'object' || data === null || !('code' in data) || !isAiLimitCode(data.code)) return;
    const messages = AI_LIMIT_MESSAGES[data.code];
    let language: 'zh' | 'en' = 'zh';
    try {
        if (localStorage.getItem('app-language') === 'en') language = 'en';
    } catch {
        // 无法读取时使用默认语言
    }
    toast.warning(messages[language]);
}

/** 断线后轮询结果的间隔 */
const RECOVERY_POLL_MS = 3000;
/** 断线后多久仍查不到请求，视为请求没有到达服务端 */
const RECOVERY_GRACE_MS = 6000;

/** 随机请求编号（32 位十六进制）；局域网 HTTP 访问不是安全上下文，不能用 randomUUID */
export function createRequestId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** fetch 没有收到响应（网络中断）时抛出 TypeError；服务端返回的错误和超时不算 */
export function isNetworkError(error: unknown): boolean {
    return error instanceof TypeError;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 按请求编号轮询服务端暂存的响应，直到请求结束或超过截止时间；
 * 查不到请求时抛出 originalError。供断线恢复与页面刷新后取回中断的响应共用。
 */
export async function recoverResponse<T>(requestId: string, deadline: number, originalError: unknown): Promise<T> {
    const lostAt = Date.now();
    while (Date.now() < deadline) {
        let stored: { state: 'running' } | { state: 'done'; status: number; body: unknown } | null = null;
        try {
            stored = await request(`/api/requests/${requestId}`, { method: 'GET', timeout: 15000 });
        } catch (error) {
            if (error instanceof ApiError && error.status === 404) {
                if (Date.now() - lostAt > RECOVERY_GRACE_MS) throw originalError;
            }
            // 其他错误（网络仍不稳定等）稍后重试
        }
        if (stored?.state === 'done') {
            if (stored.status >= 200 && stored.status < 300) return (stored.body ?? {}) as T;
            if (stored.status === 429) notifyAiDailyLimit(stored.body);
            if (stored.status === 403 && isAiConsentRequired(stored.body)) requestAiConsent('blocked');
            throw new ApiError(stored.status, '', stored.body);
        }
        await sleep(RECOVERY_POLL_MS);
    }
    throw new ApiError(408, 'Request Timeout', { message: 'AI_TIMEOUT_ERROR' });
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const { params, headers, timeout = 60000, recoverable, requestId: callerRequestId, ...rest } = options;
    const requestId = recoverable ? (callerRequestId ?? createRequestId()) : null;
    const startedAt = Date.now();

    let finalUrl = url;
    if (params) {
        const searchParams = new URLSearchParams(params);
        finalUrl += `?${searchParams.toString()}`;
    }

    const defaultHeaders: HeadersInit = {
        'Content-Type': 'application/json',
    };

    // 创建 AbortController 用于超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const res = await fetch(finalUrl, {
            headers: {
                ...defaultHeaders,
                ...(requestId ? { 'X-Request-Id': requestId } : {}),
                ...headers,
            },
            signal: controller.signal,
            ...rest,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            let errorData;
            const errorText = await res.text();
            try {
                errorData = JSON.parse(errorText) as unknown;
            } catch {
                // 响应体只能读取一次，代理返回 HTML 时也保留 HTTP 状态码。
                errorData = errorText;
            }
            if (res.status === 429) notifyAiDailyLimit(errorData);
            // 尚未同意 AI 数据授权：统一弹出授权窗口，各个 AI 按钮无需单独处理
            if (res.status === 403 && isAiConsentRequired(errorData)) requestAiConsent('blocked');
            throw new ApiError(res.status, res.statusText, errorData);
        }

        // Handle empty responses (e.g. 204 No Content)
        if (res.status === 204) {
            return {} as T;
        }

        try {
            return await res.json();
        } catch {
            // If JSON parse fails but response was OK, return text or empty object?
            // For now, assume JSON APIs.
            return {} as T;
        }
    } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
            throw new ApiError(408, 'Request Timeout', {
                message: 'AI_TIMEOUT_ERROR'
            });
        }
        if (requestId && isNetworkError(error)) {
            return recoverResponse<T>(requestId, startedAt + timeout, error);
        }
        throw error;
    }
}

export const apiClient = {
    get: <T>(url: string, options?: RequestOptions) => request<T>(url, { ...options, method: 'GET' }),
    post: <TResponse, TBody = unknown>(url: string, body: TBody, options?: RequestOptions) => request<TResponse>(url, { ...options, method: 'POST', body: JSON.stringify(body) }),
    put: <TResponse, TBody = unknown>(url: string, body: TBody, options?: RequestOptions) => request<TResponse>(url, { ...options, method: 'PUT', body: JSON.stringify(body) }),
    patch: <TResponse, TBody = unknown>(url: string, body: TBody, options?: RequestOptions) => request<TResponse>(url, { ...options, method: 'PATCH', body: JSON.stringify(body) }),
    delete: <T>(url: string, options?: RequestOptions) => request<T>(url, { ...options, method: 'DELETE' }),
};
