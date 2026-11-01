// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('隔离应用的网络限制', () => {
    it.each([{ host: 'example.invalid', port: 443 }, { host: '127.0.0.1', port: 9999 }])('在建立连接前阻止未声明地址 $host:$port', (target) => {
        const directory = mkdtempSync(join(tmpdir(), 'e2e-network-guard-'));
        try {
            const log = join(directory, 'network.jsonl');
            const result = spawnSync(process.execPath, ['--require', resolve('e2e/support/network-guard.cjs'), '-e',
                'require("node:net").connect(' + JSON.stringify(target) + ')'], {
                env: { PATH: process.env.PATH, NODE_ENV: 'test', E2E_ALLOWED_PORTS: '8123', E2E_NETWORK_LOG: log }, encoding: 'utf8', timeout: 5000,
            });
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain('E2E_EXTERNAL_CONNECTION_BLOCKED');
            expect(JSON.parse(readFileSync(log, 'utf8'))).toEqual(target);
        } finally { rmSync(directory, { recursive: true, force: true }); }
    });
});
