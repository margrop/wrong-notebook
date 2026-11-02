import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { getQuestionSaveErrorMessage } from '@/lib/question-save-error';
import { questionSaveErrorResponse } from '@/lib/question-save-error-response';
import { translations } from '@/lib/translations';

describe('保存失败的安全响应与界面提示', () => {
    it.each([
        ['P1003', 'QUESTION_SAVE_DATABASE_UNAVAILABLE', 503],
        ['P1010', 'QUESTION_SAVE_READ_ONLY', 500],
    ] as const)('Prisma 初始化异常 %s 从 errorCode 读取原因', async (code, key, status) => {
        const response = questionSaveErrorResponse(new Prisma.PrismaClientInitializationError('private connection details', '5.22.0', code));
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ message: key, code: 'DATABASE_ERROR', details: { databaseCode: code } });
    });

    it.each([
        ['P2021', 'QUESTION_SAVE_SCHEMA_MISMATCH', 500],
        ['P2022', 'QUESTION_SAVE_SCHEMA_MISMATCH', 500],
        ['P1010', 'QUESTION_SAVE_READ_ONLY', 500],
        ['P1008', 'QUESTION_SAVE_DATABASE_BUSY', 503],
        ['P2028', 'QUESTION_SAVE_DATABASE_BUSY', 503],
        ['P2034', 'QUESTION_SAVE_DATABASE_BUSY', 503],
        ['P1001', 'QUESTION_SAVE_DATABASE_UNAVAILABLE', 503],
        ['P1002', 'QUESTION_SAVE_DATABASE_UNAVAILABLE', 503],
        ['P1003', 'QUESTION_SAVE_DATABASE_UNAVAILABLE', 503],
        ['P1017', 'QUESTION_SAVE_DATABASE_UNAVAILABLE', 503],
        ['P2003', 'QUESTION_SAVE_REFERENCE_INVALID', 409],
        ['P2025', 'QUESTION_SAVE_REFERENCE_INVALID', 409],
        ['P2002', 'QUESTION_SAVE_CONFLICT', 409],
    ] as const)('数据库错误 %s 返回分类、处理建议和安全错误码', async (code, key, status) => {
        const response = questionSaveErrorResponse(Object.assign(new Error('private SQL and /private/database.db'), { code }));
        const data = await response.json();
        expect(response.status).toBe(status);
        expect(data).toEqual({ message: key, code: 'DATABASE_ERROR', details: { databaseCode: code } });
        const message = getQuestionSaveErrorMessage(new ApiError(status, '', data), translations.zh);
        expect(message).toContain(translations.zh.errors[key]);
        expect(message).toContain(code);
        expect(message).not.toContain('/private');
    });

    it.each([
        ['attempt to write a readonly database', 'QUESTION_SAVE_READ_ONLY', 500],
        ['SQLITE_READONLY', 'QUESTION_SAVE_READ_ONLY', 500],
        ['EACCES /private/database.db', 'QUESTION_SAVE_READ_ONLY', 500],
        ['database is locked', 'QUESTION_SAVE_DATABASE_BUSY', 503],
        ['SQLITE_BUSY', 'QUESTION_SAVE_DATABASE_BUSY', 503],
        ['database or disk is full', 'QUESTION_SAVE_STORAGE_FULL', 500],
        ['ENOSPC /private/database.db', 'QUESTION_SAVE_STORAGE_FULL', 500],
        ['unable to open database file', 'QUESTION_SAVE_DATABASE_UNAVAILABLE', 503],
        ['Unable to open the database file', 'QUESTION_SAVE_DATABASE_UNAVAILABLE', 503],
    ] as const)('识别 SQLite 运行错误 %s', async (cause, key, status) => {
        const response = questionSaveErrorResponse(new Error(cause));
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ message: key, code: 'DATABASE_ERROR' });
    });

    it.each(['AI_AUTH_ERROR', 'AI_TIMEOUT_ERROR', 'AI_CONNECTION_FAILED', 'AI_QUOTA_EXCEEDED', 'AI_RESPONSE_ERROR'] as const)(
        '年级识别失败显示环节、原因 %s 和手工处理办法', async (reason) => {
            const response = questionSaveErrorResponse(new Error(`${reason}: private-key`, { cause: new Error('private-key') }), 'grade');
            const data = await response.json();
            expect(response.status).toBe(502);
            expect(data).toEqual({ message: 'QUESTION_SAVE_GRADE_FAILED', code: 'AI_ERROR', details: { reason } });
            for (const t of [translations.zh, translations.en]) {
                const message = getQuestionSaveErrorMessage(new ApiError(502, '', data), t);
                expect(message).toContain(t.errors.QUESTION_SAVE_GRADE_FAILED);
                expect(message).toContain(t.errors[reason]);
                expect(message).not.toContain('private-key');
            }
        },
    );

    it('未知错误和未知 AI 原因不泄漏原始异常、堆栈或服务商返回', async () => {
        const error = new Error('Bearer secret-token, SELECT password FROM User, /private/dev.db');
        const generic = questionSaveErrorResponse(error);
        expect(await generic.json()).toEqual({ message: 'QUESTION_SAVE_FAILED', code: 'INTERNAL_ERROR' });
        const ai = questionSaveErrorResponse(error, 'grade');
        expect(await ai.json()).toEqual({ message: 'QUESTION_SAVE_GRADE_FAILED', code: 'AI_ERROR', details: { reason: 'AI_UNKNOWN_ERROR' } });
        const message = getQuestionSaveErrorMessage(new ApiError(500, '', { message: error.message, details: error.stack }), translations.zh);
        expect(message).toBe(`${translations.zh.errors.QUESTION_SAVE_FAILED} (HTTP 500)`);
    });

    it('非法 JSON 返回可处理的校验错误', async () => {
        const response = questionSaveErrorResponse(new SyntaxError('private request content'));
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ message: 'QUESTION_SAVE_INVALID_JSON', code: 'VALIDATION_ERROR' });
    });

    it('字段校验显示字段与实际限制，不回显任意服务端消息或输入值', () => {
        const error = new ApiError(400, '', { message: 'QUESTION_SAVE_INVALID_INPUT', details: [
            { path: ['questionText'], code: 'too_big', origin: 'string', maximum: 20000, message: 'secret-input' },
            { path: ['knowledgePoints'], code: 'too_big', origin: 'array', maximum: 100 },
            { path: ['knowledgePoints', 0], code: 'too_small', minimum: 1 },
        ] });
        const message = getQuestionSaveErrorMessage(error, translations.zh);
        expect(message).toContain('题目内容最多允许 20000 个字符');
        expect(message).toContain('最多允许 100 项');
        expect(message).toContain('填写有误');
        expect(message).not.toContain('secret-input');
    });

    it.each([
        [401, 'QUESTION_SAVE_UNAUTHORIZED'], [403, 'QUESTION_SAVE_FORBIDDEN'],
        [408, 'QUESTION_SAVE_TIMEOUT'], [413, 'QUESTION_SAVE_TOO_LARGE'],
        [429, 'QUESTION_SAVE_RATE_LIMITED'], [502, 'QUESTION_SAVE_SERVER_UNAVAILABLE'],
        [504, 'QUESTION_SAVE_TIMEOUT'],
    ] as const)('非 JSON 或旧服务端响应也按 HTTP %i 给出操作建议', (status, key) => {
        expect(getQuestionSaveErrorMessage(new ApiError(status, '', '<html>private proxy page</html>'), translations.en))
            .toBe(`${translations.en.errors[key]} (HTTP ${status})`);
    });

    it('每日额度使用专用提示，网络中断提示先确认保存结果', () => {
        const dailyLimit = new ApiError(429, '', { message: 'AI_DAILY_LIMIT_EXCEEDED', code: 'AI_DAILY_LIMIT_EXCEEDED' });
        expect(getQuestionSaveErrorMessage(dailyLimit, translations.zh)).toContain(translations.zh.errors.AI_DAILY_LIMIT_EXCEEDED);
        expect(getQuestionSaveErrorMessage(new TypeError('Failed to fetch'), translations.zh)).toBe(translations.zh.errors.QUESTION_SAVE_NETWORK_ERROR);
        expect(getQuestionSaveErrorMessage(new Error('boom'), translations.zh)).toBe(translations.zh.errors.QUESTION_SAVE_FAILED);
    });
});
