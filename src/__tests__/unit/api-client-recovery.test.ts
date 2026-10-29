/**
 * apiClient 耗时请求的断线恢复：请求被浏览器中断后轮询 /api/requests/:id 取回响应
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, ApiError, isNetworkError } from '@/lib/api-client';

const fetchMock = vi.fn();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const requestIdOf = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>)['X-Request-Id'];

describe('isNetworkError', () => {
    it('只有 fetch 没收到响应时的 TypeError 算网络中断', () => {
        expect(isNetworkError(new TypeError('Load failed'))).toBe(true);
        expect(isNetworkError(new ApiError(500, '', {}))).toBe(false);
        expect(isNetworkError(new Error('x'))).toBe(false);
    });
});

describe('apiClient recoverable', () => {
    it('附带 32 位十六进制的请求编号；普通请求不附带', async () => {
        fetchMock.mockResolvedValue(json(200, { ok: true }));
        await apiClient.post('/api/x', {}, { recoverable: true });
        await apiClient.post('/api/y', {});

        expect(requestIdOf(fetchMock.mock.calls[0])).toMatch(/^[a-f0-9]{32}$/);
        expect(requestIdOf(fetchMock.mock.calls[1])).toBeUndefined();
    });

    it('请求被中断后轮询取回服务端的响应', async () => {
        fetchMock
            .mockRejectedValueOnce(new TypeError('Load failed'))
            .mockResolvedValueOnce(json(200, { state: 'running' }))
            .mockResolvedValueOnce(json(200, { state: 'done', status: 200, body: { svgAnimation: '<svg/>' } }));

        const result = apiClient.post('/api/long', {}, { recoverable: true, timeout: 60_000 });
        await vi.advanceTimersByTimeAsync(3000);

        expect(await result).toEqual({ svgAnimation: '<svg/>' });
        const id = requestIdOf(fetchMock.mock.calls[0]);
        expect(fetchMock.mock.calls[1][0]).toBe(`/api/requests/${id}`);
    });

    it('服务端返回的是错误时按原错误抛出', async () => {
        fetchMock
            .mockRejectedValueOnce(new TypeError('Load failed'))
            .mockResolvedValueOnce(json(200, { state: 'done', status: 400, body: { message: 'NO_VALID_NARRATION' } }));

        await expect(apiClient.post('/api/long', {}, { recoverable: true })).rejects.toMatchObject({ status: 400, data: { message: 'NO_VALID_NARRATION' } });
    });

    it('一直查不到请求时抛出原来的网络错误', async () => {
        const lost = new TypeError('Load failed');
        fetchMock.mockRejectedValueOnce(lost).mockImplementation(async () => json(404, { message: 'Request not found' }));

        const result = apiClient.post('/api/long', {}, { recoverable: true }).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(10_000);

        expect(await result).toBe(lost);
    });

    it('超过原定超时仍在进行时按超时处理', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('Load failed')).mockImplementation(async () => json(200, { state: 'running' }));

        const result = apiClient.post('/api/long', {}, { recoverable: true, timeout: 5000 }).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(10_000);

        expect(await result).toMatchObject({ status: 408, data: { message: 'AI_TIMEOUT_ERROR' } });
    });

    it('未设置 recoverable 时网络错误直接抛出', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('Load failed'));
        await expect(apiClient.post('/api/x', {})).rejects.toBeInstanceOf(TypeError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
