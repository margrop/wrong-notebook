/**
 * 服务端埋点助手：成功与失败都记录，失败时原样抛出，不改变业务结果
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ recordEvent: vi.fn(async () => true) }));
vi.mock('@/lib/telemetry/server', () => ({ recordEvent: mocks.recordEvent }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => ({ aiProvider: 'minimax' }) }));

import { trackAnalyze, trackPracticeGrading, trackReanswer } from '@/lib/telemetry/events';
import { parseEventPayload } from '@/lib/telemetry/schema';
import type { TelemetryEventName } from '@/lib/telemetry/schema';

beforeEach(() => mocks.recordEvent.mockClear());

/** 记录的每条 payload 都能通过白名单 */
function expectValidPayloads() {
    for (const [name, payload] of mocks.recordEvent.mock.calls as unknown as Array<[TelemetryEventName, unknown]>) {
        expect(parseEventPayload(name, payload)).not.toBeNull();
    }
}

describe('服务端埋点助手', () => {
    it('trackAnalyze 记录开始与成功和耗时区间，返回原结果', async () => {
        await expect(trackAnalyze(async () => 'ok')).resolves.toBe('ok');
        expect(mocks.recordEvent).toHaveBeenCalledWith('ai_analyze_started', { provider: 'minimax' });
        expect(mocks.recordEvent).toHaveBeenCalledWith('ai_analyze_result', { ok: true, provider: 'minimax', duration: '<3s' });
        expectValidPayloads();
    });

    it('失败时记录 ok=false 并原样抛出', async () => {
        const error = new Error('AI_TIMEOUT_ERROR');
        await expect(trackAnalyze(async () => { throw error; })).rejects.toBe(error);
        expect(mocks.recordEvent).toHaveBeenCalledWith('ai_analyze_result', expect.objectContaining({ ok: false }));
        await expect(trackReanswer(async () => { throw error; })).rejects.toBe(error);
        expect(mocks.recordEvent).toHaveBeenCalledWith('ai_reanswer', { ok: false, provider: 'minimax' });
    });

    it('练习批改记一道题', async () => {
        await trackPracticeGrading(async () => ({ correct: true }));
        expect(mocks.recordEvent).toHaveBeenCalledWith('ai_practice_grading', { ok: true, count: '1' });
        expectValidPayloads();
    });
});
