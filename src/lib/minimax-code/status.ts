/**
 * 设置页显示的 MiniMax Code 账号状态：登录状态、剩余积分与今天的签到情况（实时查询）。
 * 不返回任何 Token。
 */
import { getAppConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { fetchCheckinStatus, fetchCredits } from './api';
import type { MiniMaxCodeCheckinStatus, MiniMaxCodeCredits } from './api';
import { withAccessToken } from './auth';
import { checkinDate } from './checkin';
import type { MiniMaxCodeSite } from './constants';
import { readMiniMaxCodeState } from './store';
import type { MiniMaxCodeCheckinRecord } from './store';

const logger = createLogger('minimax-code');

export interface MiniMaxCodeStatus {
    /** none：未登录；active：已登录；expired：登录失效，需要重新登录 */
    login: 'none' | 'active' | 'expired';
    account: { name: string | null; email: string | null; userId: string | null; loggedInAt: string } | null;
    credits: MiniMaxCodeCredits | null;
    checkin: {
        autoCheckin: boolean;
        /** 服务端返回的今天签到状态，查询失败时为 null */
        today: MiniMaxCodeCheckinStatus | null;
        /** 今天（北京时间）最近一次签到记录，今天还没有签到时为 null */
        last: MiniMaxCodeCheckinRecord | null;
    };
    /** 正在进行的网页登录，页面刷新后可继续等待授权 */
    pendingLogin: { url: string; userCode: string | null; expiresAt: string; intervalMs: number } | null;
}

function isAuthError(error: unknown): boolean {
    return error instanceof Error && (error.name === 'MiniMaxCodeAuthError' || error.message.startsWith('AI_AUTH_ERROR'));
}

export async function getMiniMaxCodeStatus(site: MiniMaxCodeSite = 'cn'): Promise<MiniMaxCodeStatus> {
    const state = readMiniMaxCodeState(site);
    const pending = state.pendingLogin && Date.parse(state.pendingLogin.expiresAt) > Date.now()
        ? { url: state.pendingLogin.url, userCode: state.pendingLogin.userCode, expiresAt: state.pendingLogin.expiresAt, intervalMs: state.pendingLogin.intervalMs }
        : null;
    const config = getAppConfig();
    const checkin = {
        autoCheckin: (site === 'global' ? config.minimaxCodeGlobal?.autoCheckin : config.minimaxCode?.autoCheckin) !== false,
        today: null as MiniMaxCodeCheckinStatus | null,
        last: state.lastCheckin?.date === checkinDate() ? state.lastCheckin : null,
    };
    const account = state.account;
    if (!account) return { login: 'none', account: null, credits: null, checkin, pendingLogin: pending };

    const summary = { name: account.name, email: account.email, userId: account.userId, loggedInAt: account.loggedInAt };
    if (account.invalid) return { login: 'expired', account: summary, credits: null, checkin, pendingLogin: pending };

    try {
        const [credits, today] = await withAccessToken(site, (token) => Promise.all([
            fetchCredits(site, token).catch((error) => {
                if (isAuthError(error)) throw error;
                // 积分查询失败（网络等）不代表登录失效
                logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch MiniMax Code credits');
                return null;
            }),
            fetchCheckinStatus(site, token).catch((error) => {
                if (isAuthError(error)) throw error;
                logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch MiniMax Code check-in status');
                return null;
            }),
        ]));
        return { login: 'active', account: summary, credits, checkin: { ...checkin, today }, pendingLogin: pending };
    } catch (error) {
        if (isAuthError(error)) return { login: 'expired', account: summary, credits: null, checkin, pendingLogin: pending };
        logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch MiniMax Code status');
        return { login: 'active', account: summary, credits: null, checkin, pendingLogin: pending };
    }
}
