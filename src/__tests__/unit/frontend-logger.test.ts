import { afterEach, describe, expect, it, vi } from 'vitest';
import { frontendLogger, installGlobalErrorLogging } from '@/lib/frontend-logger';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('前端日志上报', () => {
    it('Error 对象转成名称与消息后上报，其他上下文保持不变', async () => {
        const fetchMock = vi.fn(async () => new Response('{}'));
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        frontendLogger.error('[Test]', 'Request failed', { error: new TypeError('network down'), subject: 'math' });
        frontendLogger.forceFlush();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        const { logs } = JSON.parse(String(init.body));
        expect(logs[0]).toMatchObject({
            level: 'error',
            prefix: '[Test]',
            message: 'Request failed',
            context: { error: { name: 'TypeError', message: 'network down' }, subject: 'math' },
        });
    });

    it('sendToBackend 为 false 时只输出到控制台', () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);

        frontendLogger.info('[Test]', 'Local only', undefined, { sendToBackend: false });
        frontendLogger.forceFlush();

        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('全局错误上报', () => {
    it('未处理的 Promise 拒绝上报到后端，卸载后不再上报', () => {
        const fetchMock = vi.fn(async () => new Response('{}'));
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const uninstall = installGlobalErrorLogging();
        const event = new Event('unhandledrejection') as Event & { reason?: unknown };
        event.reason = new Error('lost');
        window.dispatchEvent(event);
        frontendLogger.forceFlush();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(String(init.body)).logs[0]).toMatchObject({ prefix: '[GlobalError]', context: { reason: 'lost' } });

        uninstall();
        window.dispatchEvent(event);
        frontendLogger.forceFlush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
