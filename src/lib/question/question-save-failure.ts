/**
 * 保存题目失败的领域分类：把异常归为可公开的失败结果，不依赖 HTTP 层。
 * HTTP 转换见 question-save-response.ts。
 */
import type { AiRejectionCode } from "@/lib/ai-limit-message";
import { ErrorCode } from '@/lib/error-codes';
import type { ErrorCodeType } from '@/lib/error-codes';
import { getErrorMessage } from '@/lib/error-message';

export type QuestionSaveFailureStage = 'save' | 'grade';

export type QuestionSaveFailureCode =
    | 'QUESTION_SAVE_INVALID_INPUT'
    | 'QUESTION_SAVE_INVALID_PAPER_LEVEL'
    | 'QUESTION_SAVE_GRADE_FAILED'
    | 'QUESTION_SAVE_INVALID_JSON'
    | 'QUESTION_SAVE_SCHEMA_MISMATCH'
    | 'QUESTION_SAVE_READ_ONLY'
    | 'QUESTION_SAVE_STORAGE_FULL'
    | 'QUESTION_SAVE_DATABASE_BUSY'
    | 'QUESTION_SAVE_DATABASE_UNAVAILABLE'
    | 'QUESTION_SAVE_REFERENCE_INVALID'
    | 'QUESTION_SAVE_CONFLICT'
    | 'QUESTION_SAVE_FAILED'
    | AiRejectionCode;

/** 保存题目的领域失败结果：不依赖 HTTP 层，由适配层转换为响应 */
export interface QuestionSaveFailure {
    code: QuestionSaveFailureCode;
    stage: QuestionSaveFailureStage;
    /** 建议的 HTTP 状态码 */
    status: number;
    /** 错误码分类，与统一错误响应的 code 字段一致 */
    errorCode: ErrorCodeType;
    /** 可公开的详细信息（如 AI 失败原因、数据库错误码） */
    details?: unknown;
}

const AI_REASONS = new Set([
    'AI_AUTH_ERROR', 'AI_CONNECTION_FAILED', 'AI_TIMEOUT_ERROR', 'AI_QUOTA_EXCEEDED',
    'AI_PERMISSION_DENIED', 'AI_NOT_FOUND', 'AI_SERVICE_UNAVAILABLE', 'AI_RESPONSE_ERROR',
    'AI_OUTPUT_TRUNCATED', 'AI_UNKNOWN_ERROR',
]);

/** 把异常分类为可公开保存失败结果，不泄漏原始 SQL、路径、凭据或服务商原文。 */
export function classifyQuestionSaveError(error: unknown, stage: QuestionSaveFailureStage = 'save'): QuestionSaveFailure {
    const message = getErrorMessage(error);
    if (stage === 'grade') {
        // 提供商缺少配置时会在错误码后附加说明，只提取已知错误码。
        const reason = message.match(/^(AI_[A-Z_]+)(?::|$)/)?.[1];
        return {
            code: 'QUESTION_SAVE_GRADE_FAILED',
            stage,
            status: 502,
            errorCode: ErrorCode.AI_ERROR,
            details: { reason: reason && AI_REASONS.has(reason) ? reason : 'AI_UNKNOWN_ERROR' },
        };
    }
    if (error instanceof SyntaxError) {
        return { code: 'QUESTION_SAVE_INVALID_JSON', stage, status: 400, errorCode: ErrorCode.VALIDATION_ERROR };
    }

    // Prisma 查询异常使用 code，初始化异常使用 errorCode。
    const errorCodes = typeof error === 'object' && error !== null
        ? ['code' in error ? error.code : undefined, 'errorCode' in error ? error.errorCode : undefined] : [];
    const code = errorCodes.find((value): value is string => typeof value === 'string' && /^P\d{4}$/.test(value));
    const details = code ? { databaseCode: code } : undefined;
    const databaseFailure = (key: QuestionSaveFailureCode, status = 500): QuestionSaveFailure =>
        ({ code: key, stage, status, errorCode: ErrorCode.DATABASE_ERROR, details });

    if (code === 'P2021' || code === 'P2022') return databaseFailure('QUESTION_SAVE_SCHEMA_MISMATCH');
    if (code === 'P1010' || /readonly|read-only|SQLITE_READONLY|permission denied|EACCES/i.test(message)) {
        return databaseFailure('QUESTION_SAVE_READ_ONLY');
    }
    if (/database or disk is full|SQLITE_FULL|ENOSPC/i.test(message)) return databaseFailure('QUESTION_SAVE_STORAGE_FULL');
    if (['P1008', 'P2028', 'P2034'].includes(code ?? '') || /database is locked|SQLITE_BUSY/i.test(message)) {
        return databaseFailure('QUESTION_SAVE_DATABASE_BUSY', 503);
    }
    if (['P1001', 'P1002', 'P1003', 'P1017'].includes(code ?? '') || /unable to open (?:the )?database file|SQLITE_CANTOPEN/i.test(message)) {
        return databaseFailure('QUESTION_SAVE_DATABASE_UNAVAILABLE', 503);
    }
    if (code === 'P2003' || code === 'P2025') return databaseFailure('QUESTION_SAVE_REFERENCE_INVALID', 409);
    if (code === 'P2002') return databaseFailure('QUESTION_SAVE_CONFLICT', 409);
    return {
        code: 'QUESTION_SAVE_FAILED',
        stage,
        status: 500,
        errorCode: code ? ErrorCode.DATABASE_ERROR : ErrorCode.INTERNAL_ERROR,
        details,
    };
}
