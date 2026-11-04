import { getApiErrorMessage, getErrorMessage } from "@/lib/error-message";
import type { Translations } from "@/lib/translations";

/**
 * 题目识别失败时显示的提示：后端返回已知错误码时用对应文案，返回其他消息时直接显示，
 * 网络错误提示连接失败，响应体为文本（如 HTML 错误页）时附上状态码。
 */
export function getAnalysisErrorMessage(error: unknown, t: Translations): string {
    const fallback = t.common?.messages?.analysisFailed || 'Analysis failed, please try again';

    const backendMessage = getApiErrorMessage(error);
    if (backendMessage) {
        const errors: Record<string, unknown> = t.errors ?? {};
        if (!(backendMessage in errors)) return backendMessage;
        const mapped = errors[backendMessage];
        return typeof mapped === 'string' ? mapped : fallback;
    }

    const message = getErrorMessage(error);
    if (message.includes('fetch') || message.includes('network')) {
        return t.errors?.AI_CONNECTION_FAILED || '网络连接失败';
    }
    if (typeof error === 'object' && error !== null && 'data' in error && typeof error.data === 'string') {
        const status = 'status' in error && typeof error.status === 'number' ? error.status : 'Error';
        return `${fallback} (${status})`;
    }
    return fallback;
}
