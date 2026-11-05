// @vitest-environment node
/**
 * 使用协议接口：状态只对管理员显示待同意；同意接口校验版本、写入同意状态并恢复外发；
 * 待同意期间管理写操作返回 409（真实配置目录，数据库用模拟）
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    userFindUnique: vi.fn(),
    eventCreate: vi.fn(async () => ({})),
}));

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.userFindUnique }, telemetryEvent: { create: mocks.eventCreate } } }));

import { POST as ACCEPT } from '@/app/api/admin/eula/accept/route';
import { POST as DEBUG_TOGGLE } from '@/app/api/admin/debug-logs/route';
import { GET as STATUS } from '@/app/api/eula/status/route';
import { setDebugMode } from '@/lib/debug-log';
import { getTelemetryState } from '@/lib/telemetry/state';

const admin = { user: { id: 'a1', email: 'admin@localhost', role: 'admin' }, expires: '2099-01-01' };
const user = { user: { id: 'u1', email: 'user@localhost', role: 'user' }, expires: '2099-01-01' };
const root = mkdtempSync(join(tmpdir(), 'wrong-notebook-eula-test-'));
let configDir: string;

const writeConfig = (config: object) => writeFileSync(join(configDir, 'app-config.json'), JSON.stringify(config));
const readConfig = () => JSON.parse(readFileSync(join(configDir, 'app-config.json'), 'utf8'));
const accept = (body: unknown) => ACCEPT(new Request('http://localhost/api/admin/eula/accept', { method: 'POST', body: JSON.stringify(body) }));
const as = (session: typeof admin) => {
    mocks.getServerSession.mockResolvedValue(session);
    mocks.userFindUnique.mockResolvedValue({ id: session.user.id, email: session.user.email, role: session.user.role });
};

beforeEach(() => {
    vi.clearAllMocks();
    configDir = mkdtempSync(join(root, 'config-'));
    vi.stubEnv('CONFIG_DIR', configDir);
    vi.stubEnv('TELEMETRY_DISABLED', '');
    as(admin);
});

afterAll(() => {
    vi.unstubAllEnvs();
    setDebugMode(false);
    rmSync(root, { recursive: true, force: true });
});

describe('GET /api/eula/status', () => {
    it('协议升级后管理员 pending，普通用户始终 false', async () => {
        writeConfig({ eula: { acceptedVersion: 'v0' } });
        expect(await (await STATUS()).json()).toMatchObject({ pending: true, current: 'v1', accepted: 'v0', changes: { zh: expect.any(Array) } });
        as(user);
        expect(await (await STATUS()).json()).toMatchObject({ pending: false });
    });

    it('从未同意过的存量实例不进入门禁', async () => {
        expect(await (await STATUS()).json()).toMatchObject({ pending: false, accepted: null });
    });
});

describe('POST /api/admin/eula/accept', () => {
    it('普通用户 403；版本不匹配 400', async () => {
        as(user);
        expect((await accept({ version: 'v1' })).status).toBe(403);
        as(admin);
        expect((await accept({ version: 'v0' })).status).toBe(400);
        expect((await accept({})).status).toBe(400);
    });

    it('协议升级期间：管理写操作 409，同意后恢复外发并记录 upgrade 事件', async () => {
        writeConfig({ eula: { acceptedVersion: 'v0', acceptedBy: 'initialize' }, telemetry: { forwarding: true } });
        expect(getTelemetryState()).toMatchObject({ consentPending: true, forwarding: false });
        const blocked = await DEBUG_TOGGLE(new Request('http://localhost/api/admin/debug-logs', { method: 'POST', body: JSON.stringify({ enabled: true }) }));
        expect(blocked.status).toBe(409);

        const response = await accept({ version: 'v1' });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ pending: false, accepted: 'v1' });
        expect(readConfig().eula).toMatchObject({ acceptedVersion: 'v1', acceptedBy: 'admin-dialog' });
        expect(getTelemetryState()).toMatchObject({ consentPending: false, forwarding: true });
        expect(mocks.eventCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'eula_accepted', payload: '{"version":"v1","trigger":"upgrade"}', local: false }) });

        const allowed = await DEBUG_TOGGLE(new Request('http://localhost/api/admin/debug-logs', { method: 'POST', body: JSON.stringify({ enabled: false }) }));
        expect(allowed.status).toBe(200);
    });

    it('存量实例首次同意记为 settings，外发保持原值不自动开启', async () => {
        const response = await accept({ version: 'v1' });
        expect(response.status).toBe(200);
        expect(readConfig().telemetry.forwarding).toBe(false);
        // 外发关闭且本地记录关闭时不写事件
        expect(mocks.eventCreate).not.toHaveBeenCalled();
    });
});
