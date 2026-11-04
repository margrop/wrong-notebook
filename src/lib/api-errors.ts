/**
 * 统一的 API 错误响应工具
 * 确保所有 API 错误响应格式一致
 */
import { NextResponse } from "next/server";
import { ErrorCode } from "@/lib/error-codes";
import type { ErrorCodeType } from "@/lib/error-codes";
import type { BackgroundTask } from "@/lib/background-tasks";

export { ErrorCode } from "@/lib/error-codes";
export type { ErrorCodeType } from "@/lib/error-codes";

/**
 * 标准化的错误响应结构
 */
export interface ApiErrorResponse {
    message: string;
    code?: string;
    details?: unknown;
}


/**
 * 创建统一的错误响应
 * @param message 用户友好的错误消息
 * @param status HTTP 状态码
 * @param code 可选的错误代码
 * @param details 可选的详细信息
 */
export function createErrorResponse(
    message: string,
    status: number,
    code?: ErrorCodeType,
    details?: unknown
): NextResponse<ApiErrorResponse> {
    const body: ApiErrorResponse = { message };

    if (code) {
        body.code = code;
    }

    if (details) {
        body.details = details;
    }

    return NextResponse.json(body, { status });
}

// ============ 便捷方法 ============

/**
 * 401 Unauthorized - 未认证
 */
export function unauthorized(message: string = "Unauthorized"): NextResponse<ApiErrorResponse> {
    return createErrorResponse(message, 401, ErrorCode.UNAUTHORIZED);
}

/**
 * 403 Forbidden - 无权限
 */
export function forbidden(message: string = "Forbidden"): NextResponse<ApiErrorResponse> {
    return createErrorResponse(message, 403, ErrorCode.FORBIDDEN);
}

/**
 * 404 Not Found - 资源不存在
 */
export function notFound(message: string = "Not found"): NextResponse<ApiErrorResponse> {
    return createErrorResponse(message, 404, ErrorCode.NOT_FOUND);
}

/**
 * 400 Bad Request - 请求错误
 */
export function badRequest(message: string, details?: unknown): NextResponse<ApiErrorResponse> {
    return createErrorResponse(message, 400, ErrorCode.BAD_REQUEST, details);
}

/**
 * 400 Validation Error - 验证错误
 */
export function validationError(message: string, errors?: unknown): NextResponse<ApiErrorResponse> {
    return createErrorResponse(message, 400, ErrorCode.VALIDATION_ERROR, errors);
}

/**
 * 409 Conflict - 冲突
 */
export function conflict(message: string): NextResponse<ApiErrorResponse> {
    return createErrorResponse(message, 409, ErrorCode.CONFLICT);
}

/**
 * 409 Conflict - 同一目标的后台任务正在运行（按 target 防重复）。
 * body 中附带原任务（id、kind、startedAt、target），前端可据 waitingTask.target 进入等待。
 */
export function taskAlreadyRunning(task: Pick<BackgroundTask, "id" | "kind" | "startedAt" | "target">): NextResponse<ApiErrorResponse> {
    return createErrorResponse("TASK_ALREADY_RUNNING", 409, ErrorCode.TASK_ALREADY_RUNNING, { task });
}

/**
 * 429 Too Many Requests - 请求过多，Retry-After 告诉客户端多少秒后再试
 */
export function tooManyRequests(retryAfterMs: number, message: string = "Too many requests"): NextResponse<ApiErrorResponse> {
    const response = createErrorResponse(message, 429, ErrorCode.TOO_MANY_REQUESTS);
    response.headers.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
    return response;
}

/**
 * 500 Internal Server Error - 服务器错误
 */
export function internalError(message: string = "Internal server error"): NextResponse<ApiErrorResponse> {
    return createErrorResponse(message, 500, ErrorCode.INTERNAL_ERROR);
}
