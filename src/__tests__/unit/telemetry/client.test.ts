/**
 * 浏览器遥测门面：不抛错、会话内去重、错误上报防重入，客户端形态识别
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectClient, trackAppOpened, trackError, trackEvent } from '@/lib/telemetry/client';

const beacon = vi.fn<(url: string, data?: BodyInit | null) => boolean>(() => true);

async function sentBodies(): Promise<Array<Record<string, unknown>>> {
    return Promise.all(beacon.mock.calls.map(async ([, data]) => JSON.parse(await (data as Blob).text())));
}

beforeEach(() => {
    sessionStorage.clear();
    beacon.mockClear();
    beacon.mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('trackEvent', () => {
    it('用 sendBeacon 发送；sendBeacon 失败时退回 fetch keepalive', async () => {
        trackEvent('page_viewed', { page: 'stats' });
        expect(beacon).toHaveBeenCalledWith('/api/telemetry', expect.any(Blob));
        expect(await sentBodies()).toEqual([{ t: 'event', name: 'page_viewed', payload: { page: 'stats' } }]);

        beacon.mockReturnValue(false);
        const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
        vi.stubGlobal('fetch', fetchMock);
        trackEvent('tts_used', { mode: 'browser' });
        expect(fetchMock).toHaveBeenCalledWith('/api/telemetry', expect.objectContaining({ method: 'POST', keepalive: true }));
    });

    it('发送异常时静默', () => {
        beacon.mockImplementation(() => { throw new Error('blocked'); });
        expect(() => trackEvent('app_opened', { client: 'browser' })).not.toThrow();
    });

    it('app_opened 每个会话只记一次', () => {
        trackAppOpened();
        trackAppOpened();
        expect(beacon).toHaveBeenCalledTimes(1);
    });
});

describe('trackError', () => {
    it('同一错误每个会话只报一次，不同错误分别上报', async () => {
        const error = new TypeError('boom');
        trackError({ kind: 'client', scope: '[GlobalError]', error });
        trackError({ kind: 'client', scope: '[GlobalError]', error });
        trackError({ kind: 'boundary', scope: 'app.boundary', error });
        const bodies = await sentBodies();
        expect(bodies).toHaveLength(2);
        expect(bodies[0]).toMatchObject({ t: 'error', kind: 'client', scope: '[GlobalError]', name: 'TypeError', message: 'boom', path: '/' });
    });

    it('非 Error 的拒绝原因也能上报，过长字段被截断', async () => {
        trackError({ kind: 'client', scope: '[GlobalError]', error: 'x'.repeat(5000) });
        const [body] = await sentBodies();
        expect(body).toMatchObject({ name: 'Error' });
        expect((body.message as string).length).toBe(2000);
    });

    it('上报过程中再次出错不会重入', () => {
        beacon.mockImplementation(() => {
            trackError({ kind: 'client', scope: 'nested', error: new Error('again') });
            return true;
        });
        trackError({ kind: 'client', scope: 'outer', error: new Error('first') });
        expect(beacon).toHaveBeenCalledTimes(1);
    });
});

describe('detectClient', () => {
    it('识别安卓 App、桌面版与普通浏览器', () => {
        expect(detectClient()).toBe('browser');
        vi.stubGlobal('WrongNotebookAndroid', { changeServer() {}, getServerUrl: () => '', getDeviceType: () => 'phone' });
        expect(detectClient()).toBe('android');
    });
});
