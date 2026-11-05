/**
 * API 错误码常量，不依赖 HTTP 层，领域模块与响应工具共用。
 */
/**
 * 错误代码枚举
 */
export const ErrorCode = {
    // 认证相关 (401)
    UNAUTHORIZED: 'UNAUTHORIZED',
    SESSION_EXPIRED: 'SESSION_EXPIRED',

    // 权限相关 (403)
    FORBIDDEN: 'FORBIDDEN',
    NOT_OWNER: 'NOT_OWNER',
    ADMIN_REQUIRED: 'ADMIN_REQUIRED',

    // 资源相关 (404)
    NOT_FOUND: 'NOT_FOUND',
    USER_NOT_FOUND: 'USER_NOT_FOUND',
    ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',

    // 请求相关 (400)
    BAD_REQUEST: 'BAD_REQUEST',
    INVALID_INPUT: 'INVALID_INPUT',
    MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    OPERATION_NOT_ALLOWED: 'OPERATION_NOT_ALLOWED',

    // 未授权 (403)
    /** 用户尚未同意把题目等数据发送给第三方 AI 服务商 */
    AI_CONSENT_REQUIRED: 'AI_CONSENT_REQUIRED',

    // 请求过多 (429)
    AI_DAILY_LIMIT_EXCEEDED: 'AI_DAILY_LIMIT_EXCEEDED',
    /** AI 账户实现判定额度不足（如按量计费的余额用完） */
    AI_QUOTA_INSUFFICIENT: 'AI_QUOTA_INSUFFICIENT',
    TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',

    // 冲突 (409)
    CONFLICT: 'CONFLICT',
    ALREADY_EXISTS: 'ALREADY_EXISTS',
    /** 同一目标的后台任务正在运行（按 target 防重复），body 中附带原任务 */
    TASK_ALREADY_RUNNING: 'TASK_ALREADY_RUNNING',
    /** 使用协议已升级，管理员重新同意前不能执行管理写操作 */
    EULA_PENDING: 'EULA_PENDING',

    // 服务器错误 (500)
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    DATABASE_ERROR: 'DATABASE_ERROR',
    AI_ERROR: 'AI_ERROR',
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];
