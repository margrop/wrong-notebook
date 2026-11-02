import { createErrorResponse, ErrorCode, validationError } from '@/lib/api-errors';
import { getErrorMessage } from '@/lib/error-message';

export type QuestionSaveFailureStage = 'save' | 'grade';

const AI_REASONS = new Set([
    'AI_AUTH_ERROR', 'AI_CONNECTION_FAILED', 'AI_TIMEOUT_ERROR', 'AI_QUOTA_EXCEEDED',
    'AI_PERMISSION_DENIED', 'AI_NOT_FOUND', 'AI_SERVICE_UNAVAILABLE', 'AI_RESPONSE_ERROR',
    'AI_OUTPUT_TRUNCATED', 'AI_UNKNOWN_ERROR',
]);

/** 只返回可公开的错误分类，响应不包含原始 SQL、路径、凭据或服务商原文。 */
export function questionSaveErrorResponse(error: unknown, stage: QuestionSaveFailureStage = 'save') {
    const message = getErrorMessage(error);
    if (stage === 'grade') {
        // 提供商缺少配置时会在错误码后附加说明，只提取已知错误码。
        const reason = message.match(/^(AI_[A-Z_]+)(?::|$)/)?.[1];
        return createErrorResponse('QUESTION_SAVE_GRADE_FAILED', 502, ErrorCode.AI_ERROR, {
            reason: reason && AI_REASONS.has(reason) ? reason : 'AI_UNKNOWN_ERROR',
        });
    }
    if (error instanceof SyntaxError) return validationError('QUESTION_SAVE_INVALID_JSON');

    // Prisma 查询异常使用 code，初始化异常使用 errorCode。
    const errorCodes = typeof error === 'object' && error !== null
        ? ['code' in error ? error.code : undefined, 'errorCode' in error ? error.errorCode : undefined] : [];
    const code = errorCodes.find((value): value is string => typeof value === 'string' && /^P\d{4}$/.test(value));
    const details = code ? { databaseCode: code } : undefined;
    const databaseError = (key: string, status = 500) => createErrorResponse(key, status, ErrorCode.DATABASE_ERROR, details);

    if (code === 'P2021' || code === 'P2022') return databaseError('QUESTION_SAVE_SCHEMA_MISMATCH');
    if (code === 'P1010' || /readonly|read-only|SQLITE_READONLY|permission denied|EACCES/i.test(message)) {
        return databaseError('QUESTION_SAVE_READ_ONLY');
    }
    if (/database or disk is full|SQLITE_FULL|ENOSPC/i.test(message)) return databaseError('QUESTION_SAVE_STORAGE_FULL');
    if (['P1008', 'P2028', 'P2034'].includes(code ?? '') || /database is locked|SQLITE_BUSY/i.test(message)) {
        return databaseError('QUESTION_SAVE_DATABASE_BUSY', 503);
    }
    if (['P1001', 'P1002', 'P1003', 'P1017'].includes(code ?? '') || /unable to open (?:the )?database file|SQLITE_CANTOPEN/i.test(message)) {
        return databaseError('QUESTION_SAVE_DATABASE_UNAVAILABLE', 503);
    }
    if (code === 'P2003' || code === 'P2025') return databaseError('QUESTION_SAVE_REFERENCE_INVALID', 409);
    if (code === 'P2002') return databaseError('QUESTION_SAVE_CONFLICT', 409);
    return createErrorResponse('QUESTION_SAVE_FAILED', 500, code ? ErrorCode.DATABASE_ERROR : ErrorCode.INTERNAL_ERROR, details);
}
