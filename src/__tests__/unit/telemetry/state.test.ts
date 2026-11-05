/**
 * getTelemetryState 的开关计算：环境变量优先、协议待重新同意时暂停外发、endpoint 默认值
 */
import { describe, expect, it } from 'vitest';
import { mergeTelemetryConfig } from '@/lib/config/defaults';
import { EULA_CHANGES, EULA_VERSION } from '@/lib/eula';
import { DEFAULT_TELEMETRY_ENDPOINT, resolveTelemetryState } from '@/lib/telemetry/state';

const accepted = { acceptedVersion: EULA_VERSION };

describe('resolveTelemetryState', () => {
    it('缺省配置：本地记录与外发关闭，错误回报开启，使用官方地址', () => {
        const state = resolveTelemetryState({ telemetry: mergeTelemetryConfig(undefined, undefined) }, false);
        expect(state).toMatchObject({ recording: false, errors: true, forwarding: false, endpoint: DEFAULT_TELEMETRY_ENDPOINT, retentionDays: 30, consentGiven: false });
    });

    it('同意协议后外发生效；自定义地址去掉首尾空白', () => {
        const state = resolveTelemetryState({ eula: accepted, telemetry: { forwarding: true, endpoint: ' https://t.example.com/api/v1/ingest ' } }, false);
        expect(state).toMatchObject({ forwarding: true, endpoint: 'https://t.example.com/api/v1/ingest' });
    });

    it('从未同意协议时即使配置开启也不外发', () => {
        expect(resolveTelemetryState({ telemetry: { forwarding: true } }, false)).toMatchObject({ forwarding: false, forwardingConfigured: true });
    });

    it('协议升级后待重新同意：外发暂停，配置值不变', () => {
        const state = resolveTelemetryState({ eula: { acceptedVersion: 'v0' }, telemetry: { forwarding: true, recording: true } }, false);
        expect(state).toMatchObject({ consentPending: true, forwarding: false, forwardingConfigured: true, recording: true });
    });

    it('TELEMETRY_DISABLED 强制全部关闭', () => {
        const state = resolveTelemetryState({ eula: accepted, telemetry: { forwarding: true, recording: true, errors: true } }, true);
        expect(state).toMatchObject({ lockedByEnv: true, recording: false, errors: false, forwarding: false });
    });

    it('保留天数限制在 1–365', () => {
        expect(mergeTelemetryConfig(undefined, { retentionDays: 0 }).retentionDays).toBe(1);
        expect(mergeTelemetryConfig(undefined, { retentionDays: 9999 }).retentionDays).toBe(365);
        expect(mergeTelemetryConfig(undefined, { retentionDays: Number.NaN }).retentionDays).toBe(30);
    });
});

describe('协议版本', () => {
    it('每个版本都有中英文变更摘要', () => {
        expect(EULA_CHANGES[EULA_VERSION]).toBeDefined();
        for (const changes of Object.values(EULA_CHANGES)) {
            expect(changes.zh.length).toBeGreaterThan(0);
            expect(changes.en.length).toBe(changes.zh.length);
        }
    });
});
