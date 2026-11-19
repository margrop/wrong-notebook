/**
 * MiniMax Code 登录流程与 Access Token 管理（中国站与国际站分别登录）：
 *   - 设备码登录：start 保存待授权记录，poll 轮询到授权后写入账号
 *   - 取 Token 时提前 5 分钟刷新；同一站点、同一进程内的并发刷新合并为一次，避免一次性 refresh token 被重复使用
 */
import { createLogger } from '@/lib/logger';
import {
    fetchProfile,
    MiniMaxCodeAuthError,
    pollDeviceLogin,
    refreshTokens,
    startDeviceLogin,
} from './api';
import type { DeviceLogin } from './api';
import type { MiniMaxCodeSite } from './constants';
import { readMiniMaxCodeState, updateMiniMaxCodeState } from './store';
import type { MiniMaxCodeAccount } from './store';

const logger = createLogger('minimax-code');

const REFRESH_AHEAD_MS = 5 * 60 * 1000;

// 挂在 globalThis 上，开发模式热更新后仍是同一个刷新任务；两个站点各有一个
const globalRefresh = globalThis as typeof globalThis & {
    __minimaxCodeRefresh?: Partial<Record<MiniMaxCodeSite, Promise<string>>>;
};

export type LoginPollResult =
    | { status: 'pending' }
    | { status: 'ok'; account: Pick<MiniMaxCodeAccount, 'name' | 'email' | 'userId'> }
    | { status: 'expired' | 'denied' | 'none' };

export async function startLogin(site: MiniMaxCodeSite = 'cn'): Promise<Pick<DeviceLogin, 'url' | 'userCode' | 'expiresAt' | 'intervalMs'>> {
    const login = await startDeviceLogin(site);
    updateMiniMaxCodeState((state) => ({ ...state, pendingLogin: login }), site);
    return { url: login.url, userCode: login.userCode, expiresAt: login.expiresAt, intervalMs: login.intervalMs };
}

export async function pollLogin(site: MiniMaxCodeSite = 'cn'): Promise<LoginPollResult> {
    const pending = readMiniMaxCodeState(site).pendingLogin;
    if (!pending) return { status: 'none' };
    if (Date.parse(pending.expiresAt) <= Date.now()) {
        updateMiniMaxCodeState(({ pendingLogin: _expired, ...state }) => state, site);
        return { status: 'expired' };
    }

    let tokens;
    try {
        tokens = await pollDeviceLogin(site, pending);
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'MINIMAX_CODE_LOGIN_EXPIRED' || message === 'MINIMAX_CODE_LOGIN_DENIED') {
            updateMiniMaxCodeState(({ pendingLogin: _done, ...state }) => state, site);
            return { status: message === 'MINIMAX_CODE_LOGIN_EXPIRED' ? 'expired' : 'denied' };
        }
        throw error;
    }
    if (!tokens) return { status: 'pending' };

    // 资料只用于显示，获取失败不影响登录
    const profile = await fetchProfile(site, tokens.accessToken).catch((error) => {
        logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch MiniMax Code profile');
        return null;
    });
    const account: MiniMaxCodeAccount = {
        ...tokens,
        userId: profile?.userId || null,
        name: profile?.name || null,
        email: profile?.email || null,
        loggedInAt: new Date().toISOString(),
    };
    updateMiniMaxCodeState(({ pendingLogin: _done, ...state }) => ({ ...state, account }), site);
    logger.info({ site, userId: account.userId }, 'MiniMax Code logged in');
    return { status: 'ok', account: { name: account.name, email: account.email, userId: account.userId } };
}

export function logout(site: MiniMaxCodeSite = 'cn'): void {
    updateMiniMaxCodeState(({ account: _account, pendingLogin: _pending, ...state }) => state, site);
    logger.info({ site }, 'MiniMax Code logged out');
}

async function refreshAccount(site: MiniMaxCodeSite): Promise<string> {
    const account = readMiniMaxCodeState(site).account;
    if (!account?.refreshToken || account.invalid) throw new Error('AI_AUTH_ERROR: MiniMax Code login expired');
    try {
        const tokens = await refreshTokens(site, account.refreshToken);
        // 旧 refresh token 已作废，先落盘再使用
        updateMiniMaxCodeState((state) => state.account ? { ...state, account: { ...state.account, ...tokens, invalid: false } } : state, site);
        logger.info({ site }, 'MiniMax Code token refreshed');
        return tokens.accessToken;
    } catch (error) {
        if (error instanceof MiniMaxCodeAuthError) {
            updateMiniMaxCodeState((state) => state.account ? { ...state, account: { ...state.account, invalid: true } } : state, site);
            logger.warn({ site }, 'MiniMax Code refresh token rejected, login required');
            throw new Error('AI_AUTH_ERROR: MiniMax Code login expired');
        }
        throw error;
    }
}

/** 返回某站点可用的 Access Token；force 为 true 时无论是否到期都刷新（上游返回 401 后使用） */
export async function getAccessToken(site: MiniMaxCodeSite = 'cn', options: { force?: boolean } = {}): Promise<string> {
    const account = readMiniMaxCodeState(site).account;
    if (!account) throw new Error('AI_AUTH_ERROR: MiniMax Code is not logged in');
    if (account.invalid) throw new Error('AI_AUTH_ERROR: MiniMax Code login expired');
    if (!options.force && Date.parse(account.expiresAt) - Date.now() > REFRESH_AHEAD_MS) {
        return account.accessToken;
    }
    const pending = globalRefresh.__minimaxCodeRefresh ?? {};
    if (!pending[site]) {
        pending[site] = refreshAccount(site).finally(() => {
            delete pending[site];
        });
        globalRefresh.__minimaxCodeRefresh = pending;
    }
    return pending[site];
}

/** 用某站点的 Access Token 调用 fn；凭据被拒（MiniMaxCodeAuthError 或 AI_AUTH_ERROR）时强制刷新后重试一次 */
export async function withAccessToken<T>(site: MiniMaxCodeSite, fn: (token: string) => Promise<T>): Promise<T> {
    const token = await getAccessToken(site);
    try {
        return await fn(token);
    } catch (error) {
        const rejected = error instanceof MiniMaxCodeAuthError
            || (error instanceof Error && error.message.startsWith('AI_AUTH_ERROR'));
        if (!rejected) throw error;
        return fn(await getAccessToken(site, { force: true }));
    }
}
