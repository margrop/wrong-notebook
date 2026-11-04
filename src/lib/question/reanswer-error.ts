import { getApiErrorMessage } from "@/lib/error-message";
import type { Translations } from "@/lib/translations";

type ReanswerErrorMessages = {
    default?: string;
    authError?: string;
    connectionFailed?: string;
    responseError?: string;
};

/** 校对页「重新解题」失败时的提示，按后端返回的 AI 错误码选择文案 */
export function getReanswerErrorMessage(error: unknown, t: Translations): string {
    const code = getApiErrorMessage(error) || '';
    const messages: ReanswerErrorMessages = t.errors?.reanswer || {};
    const fallback = messages.default || 'Reanswer failed';

    if (code.includes('AI_AUTH_ERROR')) return messages.authError || t.errors?.AI_AUTH_ERROR || fallback;
    if (code.includes('AI_CONNECTION_FAILED')) return messages.connectionFailed || t.errors?.AI_CONNECTION_FAILED || fallback;
    if (code.includes('AI_RESPONSE_ERROR')) return messages.responseError || t.errors?.AI_RESPONSE_ERROR || fallback;
    return fallback;
}
