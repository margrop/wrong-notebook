/**
 * /api/minimax-code 集成测试：仅管理员可用；状态接口返回登录状态和剩余积分，不返回 Token
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    userFindUnique: vi.fn(),
    startDeviceLogin: vi.fn(),
    pollDeviceLogin: vi.fn(),
    fetchProfile: vi.fn(),
    fetchCredits: vi.fn(),
    fetchCheckinStatus: vi.fn(),
    claimCheckin: vi.fn(),
    refreshTokens: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.userFindUnique } } }));
vi.mock('@/lib/minimax-code/api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/minimax-code/api')>()),
    startDeviceLogin: mocks.startDeviceLogin,
    pollDeviceLogin: mocks.pollDeviceLogin,
    fetchProfile: mocks.fetchProfile,
    fetchCredits: mocks.fetchCredits,
    fetchCheckinStatus: mocks.fetchCheckinStatus,
    claimCheckin: mocks.claimCheckin,
    refreshTokens: mocks.refreshTokens,
}));

import { DELETE, GET } from '@/app/api/minimax-code/route';
import { POST as CHECKIN } from '@/app/api/minimax-code/checkin/route';
import { GET as POLL, POST as START } from '@/app/api/minimax-code/login/route';
import { MiniMaxCodeAuthError } from '@/lib/minimax-code/api';
import { readMiniMaxCodeState, updateMiniMaxCodeState } from '@/lib/minimax-code/store';

const adminSession = { user: { id: 'admin-1', email: 'admin@localhost', role: 'admin' }, expires: '2099-01-01' };
const userSession = { user: { id: 'user-1', email: 'user@localhost', role: 'user' }, expires: '2099-01-01' };
const adminDbUser = { id: 'admin-1', email: 'admin@localhost', name: 'Admin', role: 'admin' };
const userDbUser = { id: 'user-1', email: 'user@localhost', name: 'User', role: 'user' };

let dir: string;
const originalConfigDir = process.env.CONFIG_DIR;

function inMinutes(minutes: number) {
    return new Date(Date.now() + minutes * 60_000).toISOString();
}

function saveAccount() {
    updateMiniMaxCodeState(() => ({
        account: {
            accessToken: 'mmoat_secret', refreshToken: 'refresh_secret', expiresAt: inMinutes(60),
            userId: 'u1', name: '小明', email: null, loggedInAt: '2026-10-25T00:00:00.000Z',
        },
    }));
}

beforeEach(() => {
    vi.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minimax-code-api-'));
    process.env.CONFIG_DIR = dir;
    mocks.getServerSession.mockResolvedValue(adminSession);
    mocks.userFindUnique.mockResolvedValue(adminDbUser);
});

afterEach(() => {
    process.env.CONFIG_DIR = originalConfigDir;
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('权限', () => {
    it('未登录返回 401，普通用户返回 403', async () => {
        mocks.getServerSession.mockResolvedValue(null);
        expect((await GET()).status).toBe(401);
        mocks.getServerSession.mockResolvedValue(userSession);
        mocks.userFindUnique.mockResolvedValue(userDbUser);
        expect((await GET()).status).toBe(403);
        expect((await DELETE()).status).toBe(403);
        expect((await START()).status).toBe(403);
        expect((await POLL()).status).toBe(403);
        expect((await CHECKIN()).status).toBe(403);
        expect(mocks.startDeviceLogin).not.toHaveBeenCalled();
    });
});

describe('GET /api/minimax-code', () => {
    it('未登录时返回 none', async () => {
        const data = await (await GET()).json();
        expect(data).toEqual({
            login: 'none', account: null, credits: null, pendingLogin: null,
            checkin: { autoCheckin: true, today: null, last: null },
        });
    });

    it('已登录时返回账号、剩余积分和今天的签到状态，不包含 Token', async () => {
        saveAccount();
        mocks.fetchCredits.mockResolvedValue({ total: 2400, free: 2000, purchased: 400, plan: null });
        mocks.fetchCheckinStatus.mockResolvedValue({ checkedToday: false, streakDays: 2, points: 800, bonusPoints: 400 });

        const response = await GET();
        const text = await response.text();

        expect(JSON.parse(text)).toMatchObject({
            login: 'active',
            account: { name: '小明', userId: 'u1' },
            credits: { total: 2400, free: 2000, purchased: 400 },
            checkin: { autoCheckin: true, today: { checkedToday: false, streakDays: 2 }, last: null },
        });
        expect(text).not.toContain('secret');
        expect(mocks.fetchCredits).toHaveBeenCalledWith('mmoat_secret');
    });

    it('凭据被拒且无法刷新时显示登录失效', async () => {
        saveAccount();
        mocks.fetchCredits.mockRejectedValue(new MiniMaxCodeAuthError('401'));
        mocks.refreshTokens.mockRejectedValue(new MiniMaxCodeAuthError('invalid_grant'));

        const data = await (await GET()).json();

        expect(data).toMatchObject({ login: 'expired', credits: null });
        expect(readMiniMaxCodeState().account?.invalid).toBe(true);
    });

    it('积分查询网络失败时仍显示已登录', async () => {
        saveAccount();
        mocks.fetchCredits.mockRejectedValue(new Error('fetch failed'));
        mocks.fetchCheckinStatus.mockResolvedValue({ checkedToday: true, streakDays: 1, points: 800, bonusPoints: 0 });
        expect(await (await GET()).json()).toMatchObject({ login: 'active', credits: null, checkin: { today: { checkedToday: true } } });
    });

    it('立即签到并在状态中显示今天的签到记录', async () => {
        saveAccount();
        mocks.fetchCheckinStatus.mockResolvedValue({ checkedToday: false, streakDays: 2, points: 800, bonusPoints: 400 });
        mocks.claimCheckin.mockResolvedValue({ status: 'checked-in', points: 1200, streakDays: 3 });
        mocks.fetchCredits.mockResolvedValue({ total: 3600, free: 3600, purchased: 0, plan: null });

        const record = await (await CHECKIN()).json();
        expect(record).toMatchObject({ status: 'checked-in', trigger: 'manual', points: 1200 });

        const data = await (await GET()).json();
        expect(data.checkin.last).toMatchObject({ status: 'checked-in', trigger: 'manual', points: 1200 });
    });
});

describe('网页登录', () => {
    it('发起、轮询到完成授权，再退出登录', async () => {
        mocks.startDeviceLogin.mockResolvedValue({
            url: 'https://account.minimax.cn/oauth-authorize?user_code=AB', userCode: 'AB',
            deviceCode: 'device_secret', verifier: 'verifier_secret', expiresAt: inMinutes(5), intervalMs: 3000,
        });
        const started = await (await START()).text();
        expect(JSON.parse(started)).toMatchObject({ url: expect.stringContaining('user_code=AB'), userCode: 'AB' });
        expect(started).not.toContain('secret');

        // 页面刷新后从状态接口取回待授权记录
        expect(await (await GET()).json()).toMatchObject({ pendingLogin: { userCode: 'AB' } });

        mocks.pollDeviceLogin.mockResolvedValueOnce(null);
        expect(await (await POLL()).json()).toEqual({ status: 'pending' });

        mocks.pollDeviceLogin.mockResolvedValueOnce({ accessToken: 'mmoat_secret', refreshToken: 'r', expiresAt: inMinutes(60) });
        mocks.fetchProfile.mockResolvedValue({ userId: 'u1', name: '小明', email: null });
        const done = await (await POLL()).text();
        expect(JSON.parse(done)).toMatchObject({ status: 'ok', account: { name: '小明' } });
        expect(done).not.toContain('secret');

        expect((await DELETE()).status).toBe(200);
        expect(readMiniMaxCodeState().account).toBeUndefined();
    });

    it('上游失败时返回 500', async () => {
        mocks.startDeviceLogin.mockRejectedValue(new Error('HTTP 502'));
        expect((await START()).status).toBe(500);
    });
});
