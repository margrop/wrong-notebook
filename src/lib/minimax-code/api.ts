/**
 * MiniMax Code（名之梦 MCode 客户端）服务端接口：OAuth 设备码登录、Token 续期、用户资料、积分与每日签到。
 * 接口与参数参考 CreditDaddy（MIT）的 minimaxAuth.js / minimaxClient.js。
 *
 *   - 登录：RFC 8628 设备码授权 + S256 PKCE，client_id 为客户端公开的 mcode-public
 *   - 模型：Anthropic Messages 兼容接口 https://agent.minimax.cn/mavis/api/v1/llm/v1/messages
 *   - refresh token 一次性轮换：刷新成功后旧值立即作废，调用方必须马上保存新值
 */

import "server-only";

import crypto from 'crypto';

export const MINIMAX_CODE_ACCOUNT_BASE = 'https://account.minimax.cn';
export const MINIMAX_CODE_AGENT_BASE = 'https://agent.minimax.cn';
/** 传给 Anthropic SDK 的 baseURL，SDK 会拼接 /v1/messages */
export const MINIMAX_CODE_LLM_BASE_URL = `${MINIMAX_CODE_AGENT_BASE}/mavis/api/v1/llm`;

const CLIENT_ID = 'mcode-public';
const SCOPE = 'agent.default';
const AUDIENCE = 'agent-backend';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
// 签到按北京时间结算，与官方客户端一致
const SIGNIN_QUERY = 'timezone_offset=28800&is_desktop=1&client=desktop';
const REQUEST_TIMEOUT_MS = 20_000;

/** 凭据失效（401 或刷新被拒），需要重新登录 */
export class MiniMaxCodeAuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MiniMaxCodeAuthError';
    }
}

export interface DeviceLogin {
    url: string;
    userCode: string | null;
    deviceCode: string;
    verifier: string;
    expiresAt: string;
    intervalMs: number;
}

export interface TokenSet {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string;
}

export interface MiniMaxCodeProfile {
    userId: string;
    name: string | null;
    email: string | null;
}

export interface MiniMaxCodeCredits {
    total: number;
    free: number;
    purchased: number;
    plan: string | null;
}

export interface MiniMaxCodeCheckinStatus {
    checkedToday: boolean;
    streakDays: number;
    points: number;
    bonusPoints: number;
}

export interface MiniMaxCodeClaimResult {
    /** checked-in：本次签到成功；already：今天已经签过 */
    status: 'checked-in' | 'already';
    points: number;
    streakDays: number;
}

interface BaseResp {
    base_resp?: { status_code?: number; status_msg?: string };
}

function base64Url(buf: Buffer): string {
    return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

async function readJson<T>(res: Response): Promise<T | null> {
    const text = await res.text().catch(() => '');
    try {
        return text ? JSON.parse(text) as T : null;
    } catch {
        return null;
    }
}

async function postForm<T>(url: string, fields: Record<string, string>): Promise<{ res: Response; body: T | null }> {
    const res = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(fields).toString(),
    });
    return { res, body: await readJson<T>(res) };
}

function expiresAtFrom(expiresIn: unknown): string {
    const seconds = Number(expiresIn) > 0 ? Number(expiresIn) : 3600;
    return new Date(Date.now() + seconds * 1000).toISOString();
}

/** 带 Bearer Token 请求业务接口，校验 base_resp；401 抛出 MiniMaxCodeAuthError */
async function callAgentApi<T extends BaseResp>(token: string, path: string, init: RequestInit = {}): Promise<T> {
    const res = await request(`${MINIMAX_CODE_AGENT_BASE}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...init.headers },
    });
    if (res.status === 401) throw new MiniMaxCodeAuthError('MiniMax Code token rejected (401)');
    if (!res.ok) throw new Error(`MiniMax Code request failed: HTTP ${res.status}`);
    const data = await readJson<T>(res);
    if (!data || data.base_resp?.status_code !== 0) {
        throw new Error(`MiniMax Code request failed: ${data?.base_resp?.status_msg || 'invalid response'}`);
    }
    return data;
}

/** 发起设备码授权，返回给用户打开的授权地址与轮询所需参数 */
export async function startDeviceLogin(): Promise<DeviceLogin> {
    const verifier = base64Url(crypto.randomBytes(32));
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
    const { res, body } = await postForm<{
        device_code?: string; user_code?: string; verification_uri_complete?: string; expires_in?: number; interval?: number;
    }>(`${MINIMAX_CODE_ACCOUNT_BASE}/oauth2/device/code`, {
        client_id: CLIENT_ID, scope: SCOPE, audience: AUDIENCE,
        code_challenge: challenge, code_challenge_method: 'S256',
    });
    if (!res.ok || !body?.device_code || !body.verification_uri_complete) {
        throw new Error(`MiniMax Code device login failed: HTTP ${res.status}`);
    }
    const url = String(body.verification_uri_complete);
    if (!url.startsWith('https://')) throw new Error('MiniMax Code returned a non-https authorization URL');
    return {
        url,
        userCode: body.user_code ? String(body.user_code) : null,
        deviceCode: String(body.device_code),
        verifier,
        expiresAt: expiresAtFrom(Math.max(60, Number(body.expires_in) || 300)),
        intervalMs: Math.max(2000, (Number(body.interval) || 3) * 1000),
    };
}

/** 轮询一次授权结果：用户尚未授权时返回 null */
export async function pollDeviceLogin(login: Pick<DeviceLogin, 'deviceCode' | 'verifier'>): Promise<TokenSet | null> {
    const { res, body } = await postForm<{ error?: string; access_token?: string; refresh_token?: string; expires_in?: number }>(
        `${MINIMAX_CODE_ACCOUNT_BASE}/oauth2/token`,
        { grant_type: DEVICE_GRANT, device_code: login.deviceCode, client_id: CLIENT_ID, code_verifier: login.verifier },
    );
    const error = body?.error;
    if (res.status === 400 && (error === 'authorization_pending' || error === 'slow_down')) return null;
    if (error === 'expired_token') throw new Error('MINIMAX_CODE_LOGIN_EXPIRED');
    if (error === 'access_denied') throw new Error('MINIMAX_CODE_LOGIN_DENIED');
    if (!res.ok || !body?.access_token) {
        throw new Error(`MiniMax Code login failed: HTTP ${res.status}${error ? ` ${error}` : ''}`);
    }
    return {
        accessToken: String(body.access_token),
        refreshToken: body.refresh_token ? String(body.refresh_token) : null,
        expiresAt: expiresAtFrom(body.expires_in),
    };
}

/** 用 refresh token 换新的凭据；被服务端拒绝时抛出 MiniMaxCodeAuthError */
export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
    const { res, body } = await postForm<{ access_token?: string; refresh_token?: string; expires_in?: number }>(
        `${MINIMAX_CODE_ACCOUNT_BASE}/oauth2/token`,
        { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID, scope: SCOPE, audience: AUDIENCE },
    );
    if (res.status === 400 || res.status === 401) throw new MiniMaxCodeAuthError(`MiniMax Code refresh rejected: HTTP ${res.status}`);
    if (!res.ok || !body?.access_token) throw new Error(`MiniMax Code refresh failed: HTTP ${res.status}`);
    return {
        accessToken: String(body.access_token),
        refreshToken: body.refresh_token ? String(body.refresh_token) : refreshToken,
        expiresAt: expiresAtFrom(body.expires_in),
    };
}

export async function fetchProfile(token: string): Promise<MiniMaxCodeProfile> {
    const data = await callAgentApi<BaseResp & { user_id?: string | number; user_name?: string; email?: string }>(
        token, '/matrix/api/v1/user/profile',
    );
    return { userId: String(data.user_id || ''), name: data.user_name || null, email: data.email || null };
}

export async function fetchCredits(token: string): Promise<MiniMaxCodeCredits> {
    const data = await callAgentApi<BaseResp & {
        op_credit_summary?: { total_remaining_amount?: number; free_remaining_amount?: number; purchased_remaining_amount?: number };
        total_remains_credit?: number;
        plan_name?: string;
        is_pro_builder?: boolean;
    }>(token, '/matrix/api/v1/commerce/get_membership_info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
    });
    const summary = data.op_credit_summary || {};
    const round = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
    return {
        total: round(summary.total_remaining_amount ?? data.total_remains_credit),
        free: round(summary.free_remaining_amount),
        purchased: round(summary.purchased_remaining_amount),
        plan: data.plan_name || (data.is_pro_builder ? 'Pro' : null),
    };
}

interface SigninDay {
    is_today?: boolean;
    status?: number;
    day_no?: number;
    points?: number;
    bonus_points?: number;
}

/** 查询今天的签到状态；接口没有返回今天的记录时返回 null */
export async function fetchCheckinStatus(token: string): Promise<MiniMaxCodeCheckinStatus | null> {
    const data = await callAgentApi<BaseResp & { data?: { days?: SigninDay[] } }>(
        token, `/minimax-cloud/api/v1/signin/status?${SIGNIN_QUERY}`,
    );
    const today = (data.data?.days || []).find((day) => day.is_today);
    if (!today) return null;
    return {
        // status 3 表示已领取
        checkedToday: today.status === 3,
        streakDays: today.day_no || 0,
        points: today.points || 0,
        bonusPoints: today.bonus_points || 0,
    };
}

/** 领取今天的签到奖励 */
export async function claimCheckin(token: string, today?: MiniMaxCodeCheckinStatus | null): Promise<MiniMaxCodeClaimResult> {
    const data = await callAgentApi<BaseResp & { data?: { claim_result?: number; points?: number; day_no?: number } }>(
        token, `/minimax-cloud/api/v1/signin/claim?${SIGNIN_QUERY}`, { method: 'POST' },
    );
    const result = data.data || {};
    return {
        // claim_result 2 表示今天已经领过
        status: result.claim_result === 2 ? 'already' : 'checked-in',
        points: Number(result.points) || (today ? today.points + today.bonusPoints : 0),
        streakDays: result.day_no || today?.streakDays || 0,
    };
}
