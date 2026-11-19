/**
 * MiniMax Code 接口客户端：设备码登录、Token 续期、积分与签到的请求构造和结果解析
 */
import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    claimCheckin,
    fetchCheckinStatus,
    fetchCredits,
    MiniMaxCodeAuthError,
    pollDeviceLogin,
    refreshTokens,
    startDeviceLogin,
} from '@/lib/minimax-code/api';

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function lastForm(): URLSearchParams {
    const [, init] = fetchMock.mock.calls.at(-1)!;
    return new URLSearchParams(String(init.body));
}

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('startDeviceLogin', () => {
    it('用 S256 PKCE 发起设备码授权，返回授权地址和轮询参数', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, {
            device_code: 'dev-1', user_code: 'ABCD', verification_uri_complete: 'https://account.minimax.cn/oauth-authorize?user_code=ABCD',
            expires_in: 300, interval: 5,
        }));

        const login = await startDeviceLogin();

        expect(fetchMock.mock.calls[0][0]).toBe('https://account.minimax.cn/oauth2/device/code');
        const form = lastForm();
        expect(form.get('client_id')).toBe('mcode-public');
        expect(form.get('code_challenge_method')).toBe('S256');
        const expected = crypto.createHash('sha256').update(login.verifier).digest('base64url');
        expect(form.get('code_challenge')).toBe(expected);
        expect(login).toMatchObject({ url: expect.stringContaining('user_code=ABCD'), userCode: 'ABCD', deviceCode: 'dev-1', intervalMs: 5000 });
        expect(Date.parse(login.expiresAt) - Date.now()).toBeGreaterThan(290_000);
    });

    it('国际站使用 account.minimax.io', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, {
            device_code: 'dev-g', user_code: 'GLOB', verification_uri_complete: 'https://account.minimax.io/oauth-authorize?user_code=GLOB',
            expires_in: 300, interval: 5,
        }));

        await startDeviceLogin('global');

        expect(fetchMock.mock.calls[0][0]).toBe('https://account.minimax.io/oauth2/device/code');
    });

    it('拒绝非 https 的授权地址', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { device_code: 'd', verification_uri_complete: 'http://evil.example' }));
        await expect(startDeviceLogin()).rejects.toThrow('non-https');
    });

    it('接口失败时抛出错误', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
        await expect(startDeviceLogin()).rejects.toThrow('HTTP 500');
    });
});

describe('pollDeviceLogin', () => {
    const login = { deviceCode: 'dev-1', verifier: 'v' };

    it('用户尚未授权时返回 null', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'authorization_pending' }));
        await expect(pollDeviceLogin('cn', login)).resolves.toBeNull();
        fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'slow_down' }));
        await expect(pollDeviceLogin('cn', login)).resolves.toBeNull();
    });

    it('授权完成时返回凭据', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { access_token: 'mmoat_a', refresh_token: 'r1', expires_in: 3600 }));
        const tokens = await pollDeviceLogin('cn', login);
        expect(lastForm().get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
        expect(lastForm().get('code_verifier')).toBe('v');
        expect(tokens).toMatchObject({ accessToken: 'mmoat_a', refreshToken: 'r1' });
    });

    it('超时和拒绝返回对应错误码', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'expired_token' }));
        await expect(pollDeviceLogin('cn', login)).rejects.toThrow('MINIMAX_CODE_LOGIN_EXPIRED');
        fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'access_denied' }));
        await expect(pollDeviceLogin('cn', login)).rejects.toThrow('MINIMAX_CODE_LOGIN_DENIED');
    });
});

describe('refreshTokens', () => {
    it('返回轮换后的新 refresh token', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { access_token: 'a2', refresh_token: 'r2', expires_in: 60 }));
        await expect(refreshTokens('cn', 'r1')).resolves.toMatchObject({ accessToken: 'a2', refreshToken: 'r2' });
        expect(lastForm().get('grant_type')).toBe('refresh_token');
        expect(lastForm().get('refresh_token')).toBe('r1');
    });

    it('没有返回新 refresh token 时沿用旧值', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { access_token: 'a2' }));
        await expect(refreshTokens('cn', 'r1')).resolves.toMatchObject({ refreshToken: 'r1' });
    });

    it('被拒绝时抛出 MiniMaxCodeAuthError，其余失败抛普通错误', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_grant' }));
        await expect(refreshTokens('cn', 'r1')).rejects.toBeInstanceOf(MiniMaxCodeAuthError);
        fetchMock.mockResolvedValueOnce(jsonResponse(502, {}));
        await expect(refreshTokens('cn', 'r1')).rejects.not.toBeInstanceOf(MiniMaxCodeAuthError);
    });
});

describe('积分与签到', () => {
    it('解析剩余积分，并带上 Bearer Token', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, {
            base_resp: { status_code: 0 },
            op_credit_summary: { total_remaining_amount: 2400.456, free_remaining_amount: 2000, purchased_remaining_amount: 400.456 },
            plan_name: '免费版',
        }));
        await expect(fetchCredits('cn', 'tok')).resolves.toEqual({ total: 2400.46, free: 2000, purchased: 400.46, plan: '免费版' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://agent.minimax.cn/matrix/api/v1/commerce/get_membership_info');
        expect(init.headers.Authorization).toBe('Bearer tok');
    });

    it('国际站的积分接口在 agent.minimax.io', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, {
            base_resp: { status_code: 0 },
            op_credit_summary: { total_remaining_amount: 100, free_remaining_amount: 100 },
        }));
        await fetchCredits('global', 'tok');
        expect(fetchMock.mock.calls[0][0]).toBe('https://agent.minimax.io/matrix/api/v1/commerce/get_membership_info');
    });

    it('401 抛出 MiniMaxCodeAuthError，业务错误抛出接口信息', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
        await expect(fetchCredits('cn', 'tok')).rejects.toBeInstanceOf(MiniMaxCodeAuthError);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { base_resp: { status_code: 1001, status_msg: 'busy' } }));
        await expect(fetchCredits('cn', 'tok')).rejects.toThrow('busy');
    });

    it('读取今天的签到状态', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, {
            base_resp: { status_code: 0 },
            data: { days: [{ is_today: false, status: 3 }, { is_today: true, status: 1, day_no: 3, points: 800, bonus_points: 400 }] },
        }));
        await expect(fetchCheckinStatus('cn', 'tok')).resolves.toEqual({ checkedToday: false, streakDays: 3, points: 800, bonusPoints: 400 });
        expect(fetchMock.mock.calls[0][0]).toContain('/minimax-cloud/api/v1/signin/status?timezone_offset=28800');
    });

    it('领取签到奖励，区分新签到和重复签到', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { base_resp: { status_code: 0 }, data: { claim_result: 1, points: 1200, day_no: 3 } }));
        await expect(claimCheckin('cn', 'tok')).resolves.toEqual({ status: 'checked-in', points: 1200, streakDays: 3 });
        expect(fetchMock.mock.calls[0][1].method).toBe('POST');

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { base_resp: { status_code: 0 }, data: { claim_result: 2 } }));
        await expect(claimCheckin('cn', 'tok', { checkedToday: false, streakDays: 4, points: 800, bonusPoints: 400 }))
            .resolves.toEqual({ status: 'already', points: 1200, streakDays: 4 });
    });
});
