/**
 * /api/admin/debug-logs 集成测试：管理员权限、开关调试模式、导出脱敏日志
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    getAppConfig: vi.fn(() => ({ aiProvider: 'gemini', gemini: { apiKey: 'AIza-real-key', model: 'gemini-2.5-flash' } })),
}));

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/config', () => ({ getAppConfig: mocks.getAppConfig }));

import { DELETE, GET, POST } from '@/app/api/admin/debug-logs/route';
import { GET as EXPORT } from '@/app/api/admin/debug-logs/export/route';
import { clearDebugLogs, setDebugMode } from '@/lib/debug-log';
import { createLogger } from '@/lib/logger';

const admin = { user: { id: 'admin-1', role: 'admin' }, expires: '2099-01-01' };
const user = { user: { id: 'user-1', role: 'user' }, expires: '2099-01-01' };

function toggle(body: unknown) {
    return POST(new Request('http://localhost/api/admin/debug-logs', { method: 'POST', body: JSON.stringify(body) }));
}

describe('/api/admin/debug-logs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue(admin);
    });

    afterEach(() => {
        setDebugMode(false);
        clearDebugLogs();
    });

    it('未登录返回 401，普通用户返回 403', async () => {
        mocks.getServerSession.mockResolvedValue(null);
        expect((await GET()).status).toBe(401);
        mocks.getServerSession.mockResolvedValue(user);
        expect((await GET()).status).toBe(403);
        expect((await toggle({ enabled: true })).status).toBe(403);
        expect((await EXPORT()).status).toBe(403);
        expect((await DELETE()).status).toBe(403);
    });

    it('参数不合法返回 400', async () => {
        expect((await toggle({ enabled: 'yes' })).status).toBe(400);
    });

    it('开启后记录日志，导出包含环境信息且已脱敏，清空后条数归零', async () => {
        const status = await (await toggle({ enabled: true })).json();
        expect(status).toMatchObject({ enabled: true });
        expect(status.entryCount).toBeGreaterThan(0);

        createLogger('ai:test').debug({ headers: { Authorization: 'Bearer secret-token' }, prompt: 'solve x' }, 'AI request');

        const response = await EXPORT();
        expect(response.headers.get('Content-Disposition')).toMatch(/attachment; filename="wrong-notebook-debug-.+\.json"/);
        const text = await response.text();
        expect(text).not.toContain('secret-token');
        expect(text).not.toContain('AIza-real-key');
        const report = JSON.parse(text);
        expect(report).toMatchObject({
            format: 'wrong-notebook-debug-log',
            debug: { enabled: true },
            config: { aiProvider: 'gemini', gemini: { apiKey: '[REDACTED]', model: 'gemini-2.5-flash' } },
        });
        expect(report.app.version).toBeTruthy();
        expect(report.entries).toContainEqual(expect.objectContaining({ module: 'ai:test', level: 'debug', msg: 'AI request', prompt: 'solve x' }));

        expect(await (await DELETE()).json()).toMatchObject({ enabled: true, entryCount: 0 });
        expect(await (await toggle({ enabled: false })).json()).toMatchObject({ enabled: false });
    });
});
