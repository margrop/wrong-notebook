/**
 * internalError 的可选错误回报：不传 error 时行为不变，传入时异步记入遥测且不影响响应
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ reportServerError: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/telemetry/server', () => ({ reportServerError: mocks.reportServerError }));

import { internalError, reportApiError } from '@/lib/api-errors';

describe('internalError 与错误回报', () => {
    beforeEach(() => mocks.reportServerError.mockClear());

    it('不传 error 时只返回 500，不上报', async () => {
        const response = internalError('Failed');
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ message: 'Failed', code: 'INTERNAL_ERROR' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mocks.reportServerError).not.toHaveBeenCalled();
    });

    it('传入 error 时按 scope 上报', async () => {
        const error = new TypeError('db down');
        expect(internalError('Failed', { error, scope: 'api:exams' }).status).toBe(500);
        await vi.waitFor(() => expect(mocks.reportServerError).toHaveBeenCalledWith('api:exams', error));
    });

    it('上报失败不抛错', async () => {
        mocks.reportServerError.mockRejectedValueOnce(new Error('nope'));
        expect(() => reportApiError('api', new Error('x'))).not.toThrow();
        await vi.waitFor(() => expect(mocks.reportServerError).toHaveBeenCalled());
    });
});
