/**
 * 遥测事件白名单：枚举与源常量一致、拒绝自由文本、页面映射与分桶，以及与收集服务契约兼容
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VENDOR_PROVIDER_IDS } from '@/lib/ai/vendor-presets';
import { TTS_MODES } from '@/lib/tts/constants';
import { envelopeSchema, validateItems } from '@/lib/telemetry/ingest-contract';
import {
    AI_PROVIDERS, CLIENT_EVENT_NAMES, TELEMETRY_EVENT_NAMES, countBucket, durationBucket,
    normalizeErrorName, normalizePage, parseEventPayload, rowsBucket,
} from '@/lib/telemetry/schema';
import type { TelemetryEventPayloads } from '@/lib/telemetry/schema';

/** 每个事件的样例 payload，覆盖全部白名单事件 */
const SAMPLES: TelemetryEventPayloads = {
    app_installed: { method: 'preset-admin' },
    eula_accepted: { version: 'v1', trigger: 'upgrade' },
    instance_alive: { platform: 'fnos', aiConfigured: false },
    app_opened: { client: 'pwa' },
    page_viewed: { page: 'error_detail' },
    ai_analyze_started: { provider: 'volcengine-agent' },
    ai_analyze_result: { ok: false, provider: 'minimax-code', duration: '>30s' },
    ai_reanswer: { ok: true, provider: 'anthropic' },
    ai_practice_grading: { ok: true, count: '6-20' },
    exam_paper_generation: { ok: false, count: '1' },
    data_exported: { scope: 'all', rows: '>500' },
    data_imported: { rows: '1-50' },
    tts_used: { mode: 'browser' },
    settings_changed: { section: 'telemetry' },
};

describe('事件白名单', () => {
    it('provider 与 TTS 枚举来自源常量', () => {
        expect(AI_PROVIDERS).toEqual(expect.arrayContaining(['gemini', 'openai', 'azure', 'anthropic', 'minimax-code', ...VENDOR_PROVIDER_IDS]));
        for (const mode of TTS_MODES) expect(parseEventPayload('tts_used', { mode })).toEqual({ mode });
    });

    it('样例覆盖全部事件，且都能通过校验', () => {
        expect(Object.keys(SAMPLES).sort()).toEqual([...TELEMETRY_EVENT_NAMES].sort());
        for (const name of TELEMETRY_EVENT_NAMES) expect(parseEventPayload(name, SAMPLES[name])).toEqual(SAMPLES[name]);
    });

    it('拒绝自由文本、多余字段与非法枚举', () => {
        expect(parseEventPayload('page_viewed', { page: '/error-items/abc' })).toBeNull();
        expect(parseEventPayload('app_opened', { client: 'browser', userId: 'u1' })).toBeNull();
        expect(parseEventPayload('ai_reanswer', { ok: 'yes', provider: 'openai' })).toBeNull();
        expect(parseEventPayload('eula_accepted', { version: '我同意', trigger: 'install' })).toBeNull();
    });

    it('客户端事件不包含只能由服务端记录的事件', () => {
        expect(CLIENT_EVENT_NAMES).not.toContain('app_installed');
        expect(CLIENT_EVENT_NAMES).not.toContain('instance_alive');
        expect(CLIENT_EVENT_NAMES).not.toContain('eula_accepted');
    });
});

describe('与收集服务的契约', () => {
    const now = new Date('2026-11-05T12:00:00Z');
    const day = '2026-11-05';

    it('所有事件样例都被收集服务接受', () => {
        const items = TELEMETRY_EVENT_NAMES.map((name) => ({ t: 'event', day, name, payload: SAMPLES[name] }));
        expect(validateItems(items, now)).toMatchObject({ rejected: 0 });
    });

    it('收集服务仓库的测试向量全部通过本地副本', () => {
        const fixture = JSON.parse(readFileSync(resolve('src/__tests__/fixtures/telemetry/contract-v1.json'), 'utf8'));
        const envelope = envelopeSchema.parse(fixture);
        expect(validateItems(envelope.items, new Date('2026-11-01T12:00:00Z'))).toMatchObject({ rejected: 0 });
    });

    it('错误名称规整后符合协议', () => {
        expect(normalizeErrorName('TypeError')).toBe('TypeError');
        expect(normalizeErrorName('')).toBe('Error');
        expect(normalizeErrorName('1abc')).toBe('Error');
        expect(normalizeErrorName('Bad Name!')).toBe('BadName');
        const item = { t: 'error', day, kind: 'client', scope: '[GlobalError]', name: normalizeErrorName('Chunk Load Error'), fingerprint: '0123456789abcdef' };
        expect(validateItems([item], now).rejected).toBe(0);
    });
});

describe('页面与分桶', () => {
    it('路径映射成页面枚举，不保留 ID', () => {
        expect(normalizePage('/')).toBe('home');
        expect(normalizePage('/notebooks/abc/add')).toBe('notebooks');
        expect(normalizePage('/error-items/clx123?tab=1')).toBe('error_detail');
        expect(normalizePage('/exams/1/print')).toBe('exams');
        expect(normalizePage('/admin/user/1')).toBe('admin');
        expect(normalizePage('/setup')).toBe('settings');
        expect(normalizePage('/import-tasks')).toBe('other');
    });

    it('数量、行数与耗时分桶', () => {
        expect([0, 1, 2, 5, 6, 20, 21].map(countBucket)).toEqual(['1', '1', '2-5', '2-5', '6-20', '6-20', '>20']);
        expect([0, 1, 50, 51, 500, 501].map(rowsBucket)).toEqual(['0', '1-50', '1-50', '51-500', '51-500', '>500']);
        expect([0, 2999, 3000, 9999, 10000, 29999, 30000].map(durationBucket)).toEqual(['<3s', '<3s', '3-10s', '3-10s', '10-30s', '10-30s', '>30s']);
    });
});
