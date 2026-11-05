/**
 * recordEvent 与埋点助手绝不抛错：读取配置或写库失败时返回 false，业务调用照常完成
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/config', () => ({ getAppConfig: () => { throw new Error('config unavailable'); } }));
vi.mock('@/lib/prisma', () => ({ prisma: { telemetryEvent: { create: vi.fn(async () => { throw new Error('db down'); }) } } }));

import { trackAnalyze } from '@/lib/telemetry/events';
import { recordEvent } from '@/lib/telemetry/server';

describe('遥测失败不影响业务', () => {
    it('读取配置失败时 recordEvent 返回 false 而不是拒绝', async () => {
        await expect(recordEvent('app_opened', { client: 'browser' })).resolves.toBe(false);
    });

    it('写库失败时返回 false', async () => {
        const state = { recording: true, errors: true, forwarding: false, forwardingConfigured: false, endpoint: '', retentionDays: 30, lockedByEnv: false, consentPending: false, consentGiven: true };
        await expect(recordEvent('app_opened', { client: 'browser' }, state)).resolves.toBe(false);
    });

    it('读取服务商失败时 AI 调用照常返回结果', async () => {
        await expect(trackAnalyze(async () => 'result')).resolves.toBe('result');
    });
});
