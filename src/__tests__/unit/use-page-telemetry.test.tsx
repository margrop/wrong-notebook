/**
 * 页面埋点：会话内一次 app_opened；页面枚举变化时才记 page_viewed，未登录不记
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ trackEvent: vi.fn(), trackAppOpened: vi.fn() }));
vi.mock('@/lib/telemetry/client', () => ({ trackEvent: mocks.trackEvent, trackAppOpened: mocks.trackAppOpened }));

import { usePageTelemetry } from '@/lib/hooks/use-page-telemetry';

function Probe({ path, enabled }: { path: string; enabled: boolean }) {
    usePageTelemetry(path, enabled);
    return null;
}

beforeEach(() => vi.clearAllMocks());

describe('usePageTelemetry', () => {
    it('同一页面枚举只记一次，ID 不同的详情页不重复记录', () => {
        const root = createRoot(document.createElement('div'));
        act(() => root.render(<Probe path="/login" enabled={false} />));
        expect(mocks.trackAppOpened).toHaveBeenCalledTimes(1);
        expect(mocks.trackEvent).not.toHaveBeenCalled();

        act(() => root.render(<Probe path="/error-items/a" enabled />));
        act(() => root.render(<Probe path="/error-items/b" enabled />));
        act(() => root.render(<Probe path="/stats" enabled />));
        expect(mocks.trackEvent.mock.calls).toEqual([
            ['page_viewed', { page: 'error_detail' }],
            ['page_viewed', { page: 'stats' }],
        ]);
        expect(mocks.trackAppOpened).toHaveBeenCalledTimes(1);
        act(() => root.unmount());
    });
});
