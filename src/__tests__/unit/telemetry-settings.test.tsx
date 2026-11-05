/**
 * 隐私与遥测设置、存量实例告知横幅：未同意协议时打开外发先弹出协议对话框，勾选同意后才开启
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { TimeZoneProvider } from '@/contexts/TimeZoneContext';
import { translations } from '@/lib/translations';
import type { TelemetryAdminResponse } from '@/lib/telemetry/types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: mocks.get, post: mocks.post, delete: mocks.delete } }));
vi.mock('@/lib/feedback', () => ({ toast: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn(async () => true) }));

import { TelemetrySettings } from '@/components/settings/telemetry/telemetry-settings';
import { TelemetryNoticeBanner } from '@/components/telemetry-notice-banner';

const text = translations.zh.telemetrySettings;
const base: TelemetryAdminResponse = {
    recording: false, errors: true, forwarding: false, forwardingActive: false, endpoint: '',
    defaultEndpoint: 'https://wrong-notebook-telemetry.margrop.net/api/v1/ingest', retentionDays: 30,
    lockedByEnv: false, consentPending: false, eula: { current: 'v1', acceptedVersion: null, acceptedAt: null },
    showNotice: true, pending: 0, lastFlushAt: null, lastAttempt: null, events: [], errorRecords: [],
};

let container: HTMLDivElement;

async function mount(node: React.ReactNode) {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => createRoot(container).render(
        <LanguageProvider><TimeZoneProvider initialTimeZone="Asia/Shanghai">{node}</TimeZoneProvider></LanguageProvider>,
    ));
}

const click = async (element: Element | null) => act(async () => (element as HTMLElement).click());
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label)) ?? null;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue(base);
    mocks.post.mockImplementation(async (url: string) => (url.includes('eula') ? {} : { ...base, forwarding: true, showNotice: false }));
});

afterEach(() => {
    container?.remove();
    document.body.innerHTML = '';
});

describe('TelemetrySettings', () => {
    it('未同意协议时打开外发：先弹协议对话框，勾选同意后依次调用同意与开启接口', async () => {
        await mount(<TelemetrySettings />);
        expect(container.textContent).toContain(text.eulaNotAccepted);
        await click(container.querySelector('#telemetry-forwarding'));
        expect(mocks.post).not.toHaveBeenCalled();

        const confirm = button(translations.zh.eula.accept)!;
        expect(confirm).toHaveProperty('disabled', true);
        await click(document.querySelector('#eula-consent'));
        await click(button(translations.zh.eula.accept));
        expect(mocks.post.mock.calls.map(([url, body]) => [url, body])).toEqual([
            ['/api/admin/eula/accept', { version: 'v1' }],
            ['/api/admin/telemetry', { forwarding: true }],
        ]);
    });

    it('已同意协议时直接切换开关；环境变量禁用时只读', async () => {
        mocks.get.mockResolvedValue({ ...base, eula: { current: 'v1', acceptedVersion: 'v1', acceptedAt: '2026-11-05T00:00:00Z' } });
        await mount(<TelemetrySettings />);
        await click(container.querySelector('#telemetry-forwarding'));
        expect(mocks.post).toHaveBeenCalledWith('/api/admin/telemetry', { forwarding: true });
        container.remove();

        mocks.get.mockResolvedValue({ ...base, lockedByEnv: true });
        await mount(<TelemetrySettings />);
        expect(container.textContent).toContain(text.lockedByEnv);
        expect(container.querySelector('#telemetry-recording')).toHaveProperty('disabled', true);
    });
});

describe('TelemetryNoticeBanner', () => {
    it('存量实例显示横幅；不再提示后隐藏并记录', async () => {
        await mount(<TelemetryNoticeBanner enabled />);
        expect(mocks.get).toHaveBeenCalledWith('/api/admin/telemetry?view=notice');
        expect(container.textContent).toContain(text.noticeText);
        await click(button(text.noticeDismiss));
        expect(container.textContent).not.toContain(text.noticeText);
        expect(mocks.post).toHaveBeenCalledWith('/api/admin/telemetry', { noticeDismissed: true });
    });

    it('非管理员或无需提示时不显示', async () => {
        await mount(<TelemetryNoticeBanner enabled={false} />);
        expect(mocks.get).not.toHaveBeenCalled();
        container.remove();
        mocks.get.mockResolvedValue({ ...base, showNotice: false });
        await mount(<TelemetryNoticeBanner enabled />);
        expect(container.textContent).toBe('');
    });
});
