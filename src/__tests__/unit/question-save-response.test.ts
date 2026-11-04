import { describe, expect, it } from 'vitest';
import type { SaveQuestionResult } from '@/lib/question/question-save';
import { saveQuestionResultToResponse } from '@/lib/question/question-save-response';
import type { QuestionSaveFailure } from '@/lib/question/question-save-failure';

function createdResult(): SaveQuestionResult {
    return { ok: true, status: 'created', item: { id: 'item-1', questionText: '题目' } as never };
}

function duplicateResult(): SaveQuestionResult {
    return {
        ok: true,
        status: 'duplicate',
        item: {
            id: 'item-1',
            duplicate: true,
            similarity: 1,
            mistakeRecorded: true,
            practiceRecordId: 'record-1',
            message: '重复题目',
        } as never,
    };
}

function failureResult(failure: QuestionSaveFailure): SaveQuestionResult {
    return { ok: false, error: failure };
}

describe('saveQuestionResultToResponse', () => {
    it('新题返回 201 与题目 JSON', async () => {
        const response = saveQuestionResultToResponse(createdResult());
        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({ id: 'item-1', questionText: '题目' });
    });

    it('重复题返回 200 并保留重复信息字段', async () => {
        const response = saveQuestionResultToResponse(duplicateResult());
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            id: 'item-1',
            duplicate: true,
            similarity: 1,
            mistakeRecorded: true,
            practiceRecordId: 'record-1',
            message: '重复题目',
        });
    });

    it.each([
        [{ code: 'QUESTION_SAVE_INVALID_PAPER_LEVEL', stage: 'save', status: 400, errorCode: 'VALIDATION_ERROR' }, 400, { message: 'QUESTION_SAVE_INVALID_PAPER_LEVEL', code: 'VALIDATION_ERROR' }],
        [{ code: 'QUESTION_SAVE_INVALID_INPUT', stage: 'save', status: 400, errorCode: 'VALIDATION_ERROR', details: [{ path: ['questionText'] }] }, 400, { message: 'QUESTION_SAVE_INVALID_INPUT', code: 'VALIDATION_ERROR', details: [{ path: ['questionText'] }] }],
        [{ code: 'QUESTION_SAVE_GRADE_FAILED', stage: 'grade', status: 502, errorCode: 'AI_ERROR', details: { reason: 'AI_TIMEOUT_ERROR' } }, 502, { message: 'QUESTION_SAVE_GRADE_FAILED', code: 'AI_ERROR', details: { reason: 'AI_TIMEOUT_ERROR' } }],
        [{ code: 'AI_DAILY_LIMIT_EXCEEDED', stage: 'grade', status: 429, errorCode: 'AI_DAILY_LIMIT_EXCEEDED', details: { limit: 100 } }, 429, { message: 'AI_DAILY_LIMIT_EXCEEDED', code: 'AI_DAILY_LIMIT_EXCEEDED', details: { limit: 100 } }],
        [{ code: 'QUESTION_SAVE_INVALID_JSON', stage: 'save', status: 400, errorCode: 'VALIDATION_ERROR' }, 400, { message: 'QUESTION_SAVE_INVALID_JSON', code: 'VALIDATION_ERROR' }],
        [{ code: 'QUESTION_SAVE_SCHEMA_MISMATCH', stage: 'save', status: 500, errorCode: 'DATABASE_ERROR', details: { databaseCode: 'P2022' } }, 500, { message: 'QUESTION_SAVE_SCHEMA_MISMATCH', code: 'DATABASE_ERROR', details: { databaseCode: 'P2022' } }],
        [{ code: 'QUESTION_SAVE_READ_ONLY', stage: 'save', status: 500, errorCode: 'DATABASE_ERROR' }, 500, { message: 'QUESTION_SAVE_READ_ONLY', code: 'DATABASE_ERROR' }],
        [{ code: 'QUESTION_SAVE_STORAGE_FULL', stage: 'save', status: 500, errorCode: 'DATABASE_ERROR' }, 500, { message: 'QUESTION_SAVE_STORAGE_FULL', code: 'DATABASE_ERROR' }],
        [{ code: 'QUESTION_SAVE_DATABASE_BUSY', stage: 'save', status: 503, errorCode: 'DATABASE_ERROR' }, 503, { message: 'QUESTION_SAVE_DATABASE_BUSY', code: 'DATABASE_ERROR' }],
        [{ code: 'QUESTION_SAVE_DATABASE_UNAVAILABLE', stage: 'save', status: 503, errorCode: 'DATABASE_ERROR' }, 503, { message: 'QUESTION_SAVE_DATABASE_UNAVAILABLE', code: 'DATABASE_ERROR' }],
        [{ code: 'QUESTION_SAVE_REFERENCE_INVALID', stage: 'save', status: 409, errorCode: 'DATABASE_ERROR' }, 409, { message: 'QUESTION_SAVE_REFERENCE_INVALID', code: 'DATABASE_ERROR' }],
        [{ code: 'QUESTION_SAVE_CONFLICT', stage: 'save', status: 409, errorCode: 'DATABASE_ERROR' }, 409, { message: 'QUESTION_SAVE_CONFLICT', code: 'DATABASE_ERROR' }],
        [{ code: 'QUESTION_SAVE_FAILED', stage: 'save', status: 500, errorCode: 'INTERNAL_ERROR' }, 500, { message: 'QUESTION_SAVE_FAILED', code: 'INTERNAL_ERROR' }],
        [{ code: 'QUESTION_SAVE_FAILED', stage: 'save', status: 500, errorCode: 'DATABASE_ERROR', details: { databaseCode: 'P2000' } }, 500, { message: 'QUESTION_SAVE_FAILED', code: 'DATABASE_ERROR', details: { databaseCode: 'P2000' } }],
    ] as const)('失败结果 %j 转换为相同状态码与响应体', async (failure, status, body) => {
        const response = saveQuestionResultToResponse(failureResult(failure as QuestionSaveFailure));
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual(body);
    });
});
