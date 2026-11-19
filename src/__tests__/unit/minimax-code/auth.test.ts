/**
 * MiniMax Code 登录与 Token 管理：设备码轮询、提前续期、并发刷新合并、凭据失效与 401 重试
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
    startDeviceLogin: vi.fn(),
    pollDeviceLogin: vi.fn(),
    refreshTokens: vi.fn(),
    fetchProfile: vi.fn(),
}));

vi.mock('@/lib/minimax-code/api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/minimax-code/api')>()),
    ...api,
}));

import { MiniMaxCodeAuthError } from '@/lib/minimax-code/api';
import { getAccessToken, logout, pollLogin, startLogin, withAccessToken } from '@/lib/minimax-code/auth';
import { readMiniMaxCodeState, updateMiniMaxCodeState } from '@/lib/minimax-code/store';
import type { MiniMaxCodeAccount } from '@/lib/minimax-code/store';

let dir: string;
const originalConfigDir = process.env.CONFIG_DIR;

function inMinutes(minutes: number) {
    return new Date(Date.now() + minutes * 60_000).toISOString();
}

function saveAccount(account: Partial<MiniMaxCodeAccount> = {}) {
    updateMiniMaxCodeState((state) => ({
        ...state,
        account: {
            accessToken: 'a1', refreshToken: 'r1', expiresAt: inMinutes(60),
            userId: 'u1', name: '小明', email: null, loggedInAt: new Date().toISOString(),
            ...account,
        },
    }));
}

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minimax-code-'));
    process.env.CONFIG_DIR = dir;
    Object.values(api).forEach((fn) => fn.mockReset());
});

afterEach(() => {
    process.env.CONFIG_DIR = originalConfigDir;
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('网页登录', () => {
    it('发起登录后保存待授权记录，不把 device code 返回给前端', async () => {
        api.startDeviceLogin.mockResolvedValue({
            url: 'https://account.minimax.cn/oauth-authorize?user_code=X', userCode: 'X',
            deviceCode: 'dev', verifier: 'ver', expiresAt: inMinutes(5), intervalMs: 3000,
        });
        const result = await startLogin();
        expect(result).toEqual({ url: expect.any(String), userCode: 'X', expiresAt: expect.any(String), intervalMs: 3000 });
        expect(readMiniMaxCodeState().pendingLogin?.deviceCode).toBe('dev');
    });

    it('授权完成后保存账号与资料，并清除待授权记录', async () => {
        updateMiniMaxCodeState(() => ({ pendingLogin: { url: 'u', userCode: null, deviceCode: 'dev', verifier: 'ver', expiresAt: inMinutes(5), intervalMs: 3000 } }));
        api.pollDeviceLogin.mockResolvedValueOnce(null);
        await expect(pollLogin()).resolves.toEqual({ status: 'pending' });

        api.pollDeviceLogin.mockResolvedValueOnce({ accessToken: 'a1', refreshToken: 'r1', expiresAt: inMinutes(60) });
        api.fetchProfile.mockResolvedValueOnce({ userId: 'u1', name: '小明', email: 'm@example.com' });
        await expect(pollLogin()).resolves.toEqual({ status: 'ok', account: { name: '小明', email: 'm@example.com', userId: 'u1' } });

        const state = readMiniMaxCodeState();
        expect(state.pendingLogin).toBeUndefined();
        expect(state.account).toMatchObject({ accessToken: 'a1', refreshToken: 'r1', userId: 'u1' });
        expect(fs.statSync(path.join(dir, 'minimax-code.json')).mode & 0o077).toBe(0);
    });

    it('资料获取失败不影响登录', async () => {
        updateMiniMaxCodeState(() => ({ pendingLogin: { url: 'u', userCode: null, deviceCode: 'dev', verifier: 'ver', expiresAt: inMinutes(5), intervalMs: 3000 } }));
        api.pollDeviceLogin.mockResolvedValueOnce({ accessToken: 'a1', refreshToken: 'r1', expiresAt: inMinutes(60) });
        api.fetchProfile.mockRejectedValueOnce(new Error('network'));
        await expect(pollLogin()).resolves.toMatchObject({ status: 'ok' });
        expect(readMiniMaxCodeState().account?.accessToken).toBe('a1');
    });

    it('待授权记录过期、被拒绝或不存在时返回对应状态', async () => {
        await expect(pollLogin()).resolves.toEqual({ status: 'none' });

        updateMiniMaxCodeState(() => ({ pendingLogin: { url: 'u', userCode: null, deviceCode: 'dev', verifier: 'ver', expiresAt: inMinutes(-1), intervalMs: 3000 } }));
        await expect(pollLogin()).resolves.toEqual({ status: 'expired' });
        expect(readMiniMaxCodeState().pendingLogin).toBeUndefined();

        updateMiniMaxCodeState(() => ({ pendingLogin: { url: 'u', userCode: null, deviceCode: 'dev', verifier: 'ver', expiresAt: inMinutes(5), intervalMs: 3000 } }));
        api.pollDeviceLogin.mockRejectedValueOnce(new Error('MINIMAX_CODE_LOGIN_DENIED'));
        await expect(pollLogin()).resolves.toEqual({ status: 'denied' });
    });

    it('国际站登录写入 global，不影响中国站账号', async () => {
        saveAccount();
        api.startDeviceLogin.mockResolvedValue({
            url: 'https://account.minimax.io/oauth-authorize?user_code=G', userCode: 'G',
            deviceCode: 'dev', verifier: 'ver', expiresAt: inMinutes(5), intervalMs: 3000,
        });
        await startLogin('global');
        expect(api.startDeviceLogin).toHaveBeenCalledWith('global');
        expect(readMiniMaxCodeState('global').pendingLogin?.deviceCode).toBe('dev');
        expect(readMiniMaxCodeState('cn').account?.accessToken).toBe('a1');
    });

    it('退出登录只删除所选站点的凭据', () => {
        saveAccount();
        updateMiniMaxCodeState((state) => ({
            ...state,
            account: { ...state.account!, accessToken: 'g1', refreshToken: 'gr1' },
        }), 'global');
        logout('global');
        expect(readMiniMaxCodeState('global').account).toBeUndefined();
        expect(readMiniMaxCodeState('cn').account?.accessToken).toBe('a1');
    });

    it('退出登录删除凭据，保留签到记录', () => {
        saveAccount();
        updateMiniMaxCodeState((state) => ({ ...state, lastCheckin: { date: '2026-10-25', status: 'checked-in', trigger: 'auto', at: 'x' } }));
        logout();
        expect(readMiniMaxCodeState()).toEqual({ lastCheckin: { date: '2026-10-25', status: 'checked-in', trigger: 'auto', at: 'x' } });
    });
});

describe('getAccessToken', () => {
    it('未登录或登录已失效时抛出 AI_AUTH_ERROR', async () => {
        await expect(getAccessToken()).rejects.toThrow('AI_AUTH_ERROR');
        saveAccount({ invalid: true });
        await expect(getAccessToken()).rejects.toThrow('AI_AUTH_ERROR');
    });

    it('未临近到期时直接使用当前 Token', async () => {
        saveAccount();
        await expect(getAccessToken()).resolves.toBe('a1');
        expect(api.refreshTokens).not.toHaveBeenCalled();
    });

    it('临近到期时刷新，并立即保存轮换后的 refresh token', async () => {
        saveAccount({ expiresAt: inMinutes(2) });
        api.refreshTokens.mockResolvedValue({ accessToken: 'a2', refreshToken: 'r2', expiresAt: inMinutes(60) });
        await expect(getAccessToken()).resolves.toBe('a2');
        expect(api.refreshTokens).toHaveBeenCalledWith('cn', 'r1');
        expect(readMiniMaxCodeState().account).toMatchObject({ accessToken: 'a2', refreshToken: 'r2', name: '小明' });
    });

    it('并发请求只刷新一次，避免一次性 refresh token 被重复使用', async () => {
        saveAccount({ expiresAt: inMinutes(-1) });
        let resolve!: (value: unknown) => void;
        api.refreshTokens.mockReturnValue(new Promise((r) => { resolve = r; }));
        const calls = [getAccessToken(), getAccessToken(), getAccessToken()];
        resolve({ accessToken: 'a2', refreshToken: 'r2', expiresAt: inMinutes(60) });
        await expect(Promise.all(calls)).resolves.toEqual(['a2', 'a2', 'a2']);
        expect(api.refreshTokens).toHaveBeenCalledTimes(1);
    });

    it('refresh token 被拒绝时标记登录失效', async () => {
        saveAccount({ expiresAt: inMinutes(-1) });
        api.refreshTokens.mockRejectedValue(new MiniMaxCodeAuthError('rejected'));
        await expect(getAccessToken()).rejects.toThrow('AI_AUTH_ERROR');
        expect(readMiniMaxCodeState().account?.invalid).toBe(true);
    });

    it('网络错误不标记登录失效', async () => {
        saveAccount({ expiresAt: inMinutes(-1) });
        api.refreshTokens.mockRejectedValue(new Error('fetch failed'));
        await expect(getAccessToken()).rejects.toThrow('fetch failed');
        expect(readMiniMaxCodeState().account?.invalid).toBeFalsy();
    });
});

describe('withAccessToken', () => {
    it('上游返回 401 时强制刷新并重试一次', async () => {
        saveAccount();
        api.refreshTokens.mockResolvedValue({ accessToken: 'a2', refreshToken: 'r2', expiresAt: inMinutes(60) });
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('AI_AUTH_ERROR'))
            .mockResolvedValueOnce('ok');
        await expect(withAccessToken('cn', fn)).resolves.toBe('ok');
        expect(fn.mock.calls).toEqual([['a1'], ['a2']]);
    });

    it('其他错误不重试', async () => {
        saveAccount();
        const fn = vi.fn().mockRejectedValue(new Error('AI_QUOTA_EXCEEDED'));
        await expect(withAccessToken('cn', fn)).rejects.toThrow('AI_QUOTA_EXCEEDED');
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
