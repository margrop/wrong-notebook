/**
 * MiniMax Code 每日签到（中国站与国际站分别进行）：领取签到积分，并记录最近一次结果。
 * 服务启动后每小时检查一次，当天（北京时间）尚未成功签到时自动签到；失败的签到在下一次检查时重试。
 */
import { formatDateTime } from '@/lib/date-time';
import { getAppConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';
import { claimCheckin, fetchCheckinStatus } from './api';
import { withAccessToken } from './auth';
import { MINIMAX_CODE_SITE_IDS } from './constants';
import type { MiniMaxCodeSite } from './constants';
import { readMiniMaxCodeState, updateMiniMaxCodeState } from './store';
import type { MiniMaxCodeCheckinRecord, MiniMaxCodeState } from './store';

const logger = createLogger('minimax-code:checkin');

/** MiniMax 按北京时间结算签到日 */
export const CHECKIN_TIME_ZONE = 'Asia/Shanghai';
const FIRST_CHECK_DELAY_MS = 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

const globalScheduler = globalThis as typeof globalThis & { __minimaxCodeCheckinTimer?: ReturnType<typeof setInterval> };

export function checkinDate(now = new Date()): string {
    return formatDateTime(now, 'yyyy-MM-dd', CHECKIN_TIME_ZONE);
}

/** 已登录、开启了自动签到，且今天还没有成功签到时需要自动签到 */
export function shouldAutoCheckin(state: MiniMaxCodeState, autoCheckin: boolean | undefined, now = new Date()): boolean {
    if (autoCheckin === false || !state.account || state.account.invalid) return false;
    const last = state.lastCheckin;
    return !last || last.date !== checkinDate(now) || last.status === 'failed';
}

/** 签到一次：今天已签到时只记录状态，不重复领取 */
export async function runCheckin(trigger: MiniMaxCodeCheckinRecord['trigger'], site: MiniMaxCodeSite = 'cn'): Promise<MiniMaxCodeCheckinRecord> {
    const now = new Date();
    let record: MiniMaxCodeCheckinRecord;
    try {
        const result = await withAccessToken(site, async (token) => {
            const today = await fetchCheckinStatus(site, token);
            if (today?.checkedToday) {
                return { status: 'already' as const, points: today.points + today.bonusPoints, streakDays: today.streakDays };
            }
            return claimCheckin(site, token, today);
        });
        record = { date: checkinDate(now), trigger, at: now.toISOString(), ...result };
        logger.info({ site, trigger, status: record.status, points: record.points, streakDays: record.streakDays }, 'MiniMax Code check-in finished');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        record = { date: checkinDate(now), status: 'failed', trigger, error: message, at: now.toISOString() };
        logger.warn({ site, trigger, error: message }, 'MiniMax Code check-in failed');
    }
    // 今天已有成功记录时，失败的重试不覆盖它
    updateMiniMaxCodeState((state) => {
        const last = state.lastCheckin;
        const keep = record.status === 'failed' && last?.date === record.date && last.status !== 'failed';
        return keep ? state : { ...state, lastCheckin: record };
    }, site);
    return record;
}

export async function autoCheckinIfDue(site: MiniMaxCodeSite = 'cn'): Promise<void> {
    const config = getAppConfig();
    const autoCheckin = site === 'global' ? config.minimaxCodeGlobal?.autoCheckin : config.minimaxCode?.autoCheckin;
    if (!shouldAutoCheckin(readMiniMaxCodeState(site), autoCheckin)) return;
    await runCheckin('auto', site);
}

/** 服务启动时调用：启动后 1 分钟检查一次，之后每小时检查两个站点 */
export function startCheckinScheduler(): void {
    if (globalScheduler.__minimaxCodeCheckinTimer) return;
    const tick = () => {
        for (const site of MINIMAX_CODE_SITE_IDS) {
            autoCheckinIfDue(site).catch((error) => logger.error({ site, error }, 'MiniMax Code auto check-in crashed'));
        }
    };
    setTimeout(tick, FIRST_CHECK_DELAY_MS).unref?.();
    globalScheduler.__minimaxCodeCheckinTimer = setInterval(tick, CHECK_INTERVAL_MS);
    globalScheduler.__minimaxCodeCheckinTimer.unref?.();
    logger.info('MiniMax Code check-in scheduler started');
}
