/**
 * lib/api-errors.ts 单元测试
 * 测试统一的 API 错误响应工具
 */
import { describe, it, expect } from 'vitest';
import {
    createErrorResponse,
    unauthorized,
    forbidden,
    notFound,
    badRequest,
    validationError,
    conflict,
    internalError,
    taskAlreadyRunning,
    ErrorCode,
} from '@/lib/api-errors';

describe('lib/api-errors', () => {
    describe('createErrorResponse (创建错误响应)', () => {
        it('应该创建基本错误响应', async () => {
            const response = createErrorResponse('Test error', 400);
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.message).toBe('Test error');
            expect(data.code).toBeUndefined();
            expect(data.details).toBeUndefined();
        });

        it('应该包含错误代码', async () => {
            const response = createErrorResponse('Test error', 400, ErrorCode.BAD_REQUEST);
            const data = await response.json();

            expect(data.message).toBe('Test error');
            expect(data.code).toBe('BAD_REQUEST');
        });

        it('应该包含详细信息', async () => {
            const details = { field: 'email', error: 'Invalid format' };
            const response = createErrorResponse('Validation failed', 400, ErrorCode.VALIDATION_ERROR, details);
            const data = await response.json();

            expect(data.message).toBe('Validation failed');
            expect(data.details).toEqual(details);
        });
    });

    describe('unauthorized (401)', () => {
        it('应该返回 401 状态码', async () => {
            const response = unauthorized();
            expect(response.status).toBe(401);
        });

        it('应该返回默认消息', async () => {
            const response = unauthorized();
            const data = await response.json();
            expect(data.message).toBe('Unauthorized');
        });

        it('应该支持自定义消息', async () => {
            const response = unauthorized('Please login first');
            const data = await response.json();
            expect(data.message).toBe('Please login first');
        });

        it('应该包含 UNAUTHORIZED 错误代码', async () => {
            const response = unauthorized();
            const data = await response.json();
            expect(data.code).toBe('UNAUTHORIZED');
        });
    });

    describe('forbidden (403)', () => {
        it('应该返回 403 状态码', async () => {
            const response = forbidden();
            expect(response.status).toBe(403);
        });

        it('应该返回默认消息', async () => {
            const response = forbidden();
            const data = await response.json();
            expect(data.message).toBe('Forbidden');
        });

        it('应该支持自定义消息', async () => {
            const response = forbidden('Admin access required');
            const data = await response.json();
            expect(data.message).toBe('Admin access required');
        });
    });

    describe('notFound (404)', () => {
        it('应该返回 404 状态码', async () => {
            const response = notFound();
            expect(response.status).toBe(404);
        });

        it('应该返回默认消息', async () => {
            const response = notFound();
            const data = await response.json();
            expect(data.message).toBe('Not found');
        });

        it('应该支持自定义消息', async () => {
            const response = notFound('User not found');
            const data = await response.json();
            expect(data.message).toBe('User not found');
        });
    });

    describe('badRequest (400)', () => {
        it('应该返回 400 状态码', async () => {
            const response = badRequest('Invalid input');
            expect(response.status).toBe(400);
        });

        it('应该返回消息', async () => {
            const response = badRequest('Invalid email format');
            const data = await response.json();
            expect(data.message).toBe('Invalid email format');
        });

        it('应该支持详细信息', async () => {
            const details = { field: 'password', minLength: 6 };
            const response = badRequest('Password too short', details);
            const data = await response.json();
            expect(data.details).toEqual(details);
        });
    });

    describe('validationError (400)', () => {
        it('应该返回 400 状态码', async () => {
            const response = validationError('Validation failed');
            expect(response.status).toBe(400);
        });

        it('应该包含 VALIDATION_ERROR 错误代码', async () => {
            const response = validationError('Validation failed');
            const data = await response.json();
            expect(data.code).toBe('VALIDATION_ERROR');
        });

        it('应该支持验证错误列表', async () => {
            const errors = [
                { field: 'email', message: 'Invalid format' },
                { field: 'name', message: 'Required' },
            ];
            const response = validationError('Validation failed', errors);
            const data = await response.json();
            expect(data.details).toEqual(errors);
        });
    });

    describe('conflict (409)', () => {
        it('应该返回 409 状态码', async () => {
            const response = conflict('Email already exists');
            expect(response.status).toBe(409);
        });

        it('应该包含 CONFLICT 错误代码', async () => {
            const response = conflict('Resource already exists');
            const data = await response.json();
            expect(data.code).toBe('CONFLICT');
        });
    });

    describe('taskAlreadyRunning (409)', () => {
        it('应该返回 409 状态码与 TASK_ALREADY_RUNNING 错误码', async () => {
            const task = { id: 'task-1', kind: 'fix_text' as const, startedAt: '2026-11-04T10:00:00Z', target: 'import-batch:abc:fix-text' };
            const response = taskAlreadyRunning(task);
            expect(response.status).toBe(409);
            const data = await response.json();
            expect(data.code).toBe('TASK_ALREADY_RUNNING');
            expect(data.message).toBe('TASK_ALREADY_RUNNING');
            expect(data.details.task).toEqual(task);
        });
    });

    describe('internalError (500)', () => {
        it('应该返回 500 状态码', async () => {
            const response = internalError();
            expect(response.status).toBe(500);
        });

        it('应该返回默认消息', async () => {
            const response = internalError();
            const data = await response.json();
            expect(data.message).toBe('Internal server error');
        });

        it('应该支持自定义消息', async () => {
            const response = internalError('Database connection failed');
            const data = await response.json();
            expect(data.message).toBe('Database connection failed');
        });

        it('应该包含 INTERNAL_ERROR 错误代码', async () => {
            const response = internalError();
            const data = await response.json();
            expect(data.code).toBe('INTERNAL_ERROR');
        });
    });

    describe('ErrorCode (错误代码常量)', () => {
        it('应该包含认证相关代码', () => {
            expect(ErrorCode.UNAUTHORIZED).toBe('UNAUTHORIZED');
            expect(ErrorCode.SESSION_EXPIRED).toBe('SESSION_EXPIRED');
        });

        it('应该包含权限相关代码', () => {
            expect(ErrorCode.FORBIDDEN).toBe('FORBIDDEN');
            expect(ErrorCode.NOT_OWNER).toBe('NOT_OWNER');
            expect(ErrorCode.ADMIN_REQUIRED).toBe('ADMIN_REQUIRED');
        });

        it('应该包含资源相关代码', () => {
            expect(ErrorCode.NOT_FOUND).toBe('NOT_FOUND');
            expect(ErrorCode.USER_NOT_FOUND).toBe('USER_NOT_FOUND');
            expect(ErrorCode.ITEM_NOT_FOUND).toBe('ITEM_NOT_FOUND');
        });

        it('应该包含请求相关代码', () => {
            expect(ErrorCode.BAD_REQUEST).toBe('BAD_REQUEST');
            expect(ErrorCode.INVALID_INPUT).toBe('INVALID_INPUT');
            expect(ErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
        });

        it('应该包含服务器错误代码', () => {
            expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
            expect(ErrorCode.DATABASE_ERROR).toBe('DATABASE_ERROR');
            expect(ErrorCode.AI_ERROR).toBe('AI_ERROR');
        });
    });
});
