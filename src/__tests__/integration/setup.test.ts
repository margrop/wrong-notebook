/**
 * /api/setup 集成测试：安装向导状态与完成标记
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getAppConfig: vi.fn(),
    updateAppConfig: vi.fn(),
    subjectCount: vi.fn(),
    getServerSession: vi.fn(),
    userFindUnique: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
    getAppConfig: mocks.getAppConfig,
    updateAppConfig: mocks.updateAppConfig,
}));
vi.mock('@/lib/prisma', () => ({
    prisma: {
        subject: { count: mocks.subjectCount },
        user: { findUnique: mocks.userFindUnique },
    },
}));
vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET, POST } from '@/app/api/setup/route';

const adminSession = { user: { id: 'admin-1', email: 'admin@localhost', role: 'admin' }, expires: '2099-01-01' };
const userSession = { user: { id: 'user-1', email: 'user@localhost', role: 'user' }, expires: '2099-01-01' };

describe('/api/setup', () => {
    const adminDbUser = { id: 'admin-1', email: 'admin@localhost', name: 'Admin', role: 'admin' };
    const userDbUser = { id: 'user-1', email: 'user@localhost', name: 'User', role: 'user' };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getServerSession.mockResolvedValue(adminSession);
        mocks.getAppConfig.mockReturnValue({ aiProvider: 'minimax' });
        mocks.subjectCount.mockResolvedValue(0);
        mocks.userFindUnique.mockResolvedValue(adminDbUser);
    });

    describe('访问控制', () => {
        it('未登录返回 401', async () => {
            mocks.getServerSession.mockResolvedValue(null);

            expect((await GET()).status).toBe(401);
            expect((await POST()).status).toBe(401);
        });

        it('普通用户返回 403，且不能标记完成', async () => {
            mocks.getServerSession.mockResolvedValue(userSession);
            mocks.userFindUnique.mockResolvedValue(userDbUser);

            expect((await GET()).status).toBe(403);
            expect((await POST()).status).toBe(403);
            expect(mocks.updateAppConfig).not.toHaveBeenCalled();
        });
    });

    describe('GET 向导状态', () => {
        it('全新安装（未完成向导且没有错题本）需要进入向导', async () => {
            const data = await (await GET()).json();

            expect(data).toEqual({ setupCompleted: false, needsSetup: true });
        });

        it('已有错题本的旧实例升级后不自动进入向导', async () => {
            mocks.subjectCount.mockResolvedValue(3);

            const data = await (await GET()).json();

            expect(data).toEqual({ setupCompleted: false, needsSetup: false });
        });

        it('已完成向导时不再进入，也不查询错题本', async () => {
            mocks.getAppConfig.mockReturnValue({ aiProvider: 'minimax', setupCompletedAt: '2026-10-25T00:00:00.000Z' });

            const data = await (await GET()).json();

            expect(data).toEqual({ setupCompleted: true, needsSetup: false });
            expect(mocks.subjectCount).not.toHaveBeenCalled();
        });
    });

    describe('POST 完成向导', () => {
        it('写入完成时间', async () => {
            const response = await POST();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.setupCompleted).toBe(true);
            const saved = mocks.updateAppConfig.mock.calls[0][0];
            expect(Object.keys(saved)).toEqual(['setupCompletedAt']);
            expect(new Date(saved.setupCompletedAt).toISOString()).toBe(saved.setupCompletedAt);
        });

        it('写配置失败返回 500', async () => {
            mocks.updateAppConfig.mockImplementation(() => { throw new Error('EACCES'); });

            expect((await POST()).status).toBe(500);
        });
    });
});
