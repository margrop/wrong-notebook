/**
 * 耗时 AI 请求被浏览器中断后，轮询后台任务等待结果
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNetworkError, waitForBackgroundTask } from '@/lib/background-task-recovery';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: mocks.get } }));

const task = (fields: Record<string, unknown>) => ({ kind: 'svg_narration', link: '/error-items/e1', status: 'running', error: null, startedAt: new Date().toISOString(), ...fields });
const wait = () => waitForBackgroundTask({ kind: 'svg_narration', link: '/error-items/e1', since: Date.now(), timeoutMs: 60_000 });

beforeEach(() => {
    vi.useFakeTimers();
    mocks.get.mockReset();
});

afterEach(() => vi.useRealTimers());

describe('isNetworkError', () => {
    it('只把没有收到响应的 fetch 错误视为网络中断', () => {
        expect(isNetworkError(new TypeError('Load failed'))).toBe(true);
        expect(isNetworkError(Object.assign(new Error('x'), { status: 500, data: {} }))).toBe(false);
        expect(isNetworkError({ status: 408, data: { message: 'AI_TIMEOUT_ERROR' } })).toBe(false);
        expect(isNetworkError(new Error('other'))).toBe(false);
        expect(isNetworkError(null)).toBe(false);
    });
});

describe('waitForBackgroundTask', () => {
    it('轮询直到同页面同类任务结束，取最新的一个', async () => {
        const old = new Date(Date.now() - 60_000).toISOString();
        mocks.get
            .mockResolvedValueOnce({ tasks: [task({ status: 'failed', startedAt: old }), task({}), task({ kind: 'svg_animation', status: 'succeeded' })] })
            .mockResolvedValueOnce({ tasks: [task({ status: 'failed', startedAt: old }), task({ status: 'succeeded' })] });

        const result = wait();
        await vi.advanceTimersByTimeAsync(3000);

        expect(await result).toEqual({ status: 'succeeded' });
        expect(mocks.get).toHaveBeenCalledTimes(2);
    });

    it('任务失败时返回错误码', async () => {
        mocks.get.mockResolvedValue({ tasks: [task({ status: 'failed', error: 'NO_VALID_NARRATION' })] });
        expect(await wait()).toEqual({ status: 'failed', error: 'NO_VALID_NARRATION' });
    });

    it('一直查不到对应任务时返回 null（请求没有到达服务端）', async () => {
        mocks.get.mockResolvedValue({ tasks: [task({ link: '/error-items/other' })] });

        const result = wait();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(await result).toBeNull();
    });
});
