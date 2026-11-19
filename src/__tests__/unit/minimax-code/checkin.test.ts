/**
 * MiniMax Code 每日签到：是否需要自动签到、签到结果记录、失败重试与定时任务
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    fetchCheckinStatus: vi.fn(),
    claimCheckin: vi.fn(),
    withAccessToken: vi.fn(),
    autoCheckin: true as boolean | undefined,
}));

vi.mock('@/lib/minimax-code/api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/minimax-code/api')>()),
    fetchCheckinStatus: mocks.fetchCheckinStatus,
    claimCheckin: mocks.claimCheckin,
}));
vi.mock('@/lib/minimax-code/auth', () => ({ withAccessToken: mocks.withAccessToken }));
vi.mock('@/lib/config', () => ({
    getAppConfig: () => ({
        minimaxCode: { autoCheckin: mocks.autoCheckin },
        minimaxCodeGlobal: { autoCheckin: mocks.autoCheckin },
    }),
}));

import { autoCheckinIfDue, checkinDate, runCheckin, shouldAutoCheckin, startCheckinScheduler } from '@/lib/minimax-code/checkin';
import { readMiniMaxCodeState, updateMiniMaxCodeState } from '@/lib/minimax-code/store';
import type { MiniMaxCodeState } from '@/lib/minimax-code/store';

const account = {
    accessToken: 'a', refreshToken: 'r', expiresAt: '2099-01-01T00:00:00.000Z',
    userId: 'u1', name: null, email: null, loggedInAt: '2026-10-25T00:00:00.000Z',
};

let dir: string;
const originalConfigDir = process.env.CONFIG_DIR;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minimax-checkin-'));
    process.env.CONFIG_DIR = dir;
    vi.clearAllMocks();
    mocks.autoCheckin = true;
    mocks.withAccessToken.mockImplementation((_site: string, fn: (token: string) => Promise<unknown>) => fn('tok'));
});

afterEach(() => {
    process.env.CONFIG_DIR = originalConfigDir;
    fs.rmSync(dir, { recursive: true, force: true });
    vi.useRealTimers();
});

describe('checkinDate', () => {
    it('按北京时间计算签到日', () => {
        expect(checkinDate(new Date('2026-10-24T15:59:00Z'))).toBe('2026-10-24');
        expect(checkinDate(new Date('2026-10-24T16:00:00Z'))).toBe('2026-10-25');
    });
});

describe('shouldAutoCheckin', () => {
    const now = new Date('2026-10-25T02:00:00Z');
    const today = checkinDate(now);

    it('已登录且今天没有成功签到时需要签到', () => {
        expect(shouldAutoCheckin({ account }, true, now)).toBe(true);
        expect(shouldAutoCheckin({ account, lastCheckin: { date: '2026-10-24', status: 'checked-in', trigger: 'auto', at: '' } }, undefined, now)).toBe(true);
        expect(shouldAutoCheckin({ account, lastCheckin: { date: today, status: 'failed', trigger: 'auto', at: '' } }, true, now)).toBe(true);
    });

    it('今天已签到、关闭自动签到、未登录或登录失效时不签到', () => {
        const done: MiniMaxCodeState = { account, lastCheckin: { date: today, status: 'already', trigger: 'auto', at: '' } };
        expect(shouldAutoCheckin(done, true, now)).toBe(false);
        expect(shouldAutoCheckin({ account }, false, now)).toBe(false);
        expect(shouldAutoCheckin({}, true, now)).toBe(false);
        expect(shouldAutoCheckin({ account: { ...account, invalid: true } }, true, now)).toBe(false);
    });
});

describe('runCheckin', () => {
    it('今天未签到时领取奖励并记录', async () => {
        const today = { checkedToday: false, streakDays: 3, points: 800, bonusPoints: 400 };
        mocks.fetchCheckinStatus.mockResolvedValue(today);
        mocks.claimCheckin.mockResolvedValue({ status: 'checked-in', points: 1200, streakDays: 3 });

        const record = await runCheckin('auto');

        expect(mocks.claimCheckin).toHaveBeenCalledWith('cn', 'tok', today);
        expect(record).toMatchObject({ status: 'checked-in', trigger: 'auto', points: 1200, streakDays: 3, date: checkinDate() });
        expect(readMiniMaxCodeState().lastCheckin).toEqual(record);
    });

    it('国际站签到只写入 global 状态', async () => {
        const today = { checkedToday: false, streakDays: 1, points: 10, bonusPoints: 0 };
        mocks.fetchCheckinStatus.mockResolvedValue(today);
        mocks.claimCheckin.mockResolvedValue({ status: 'checked-in', points: 10, streakDays: 1 });

        const record = await runCheckin('manual', 'global');

        expect(mocks.fetchCheckinStatus).toHaveBeenCalledWith('global', 'tok');
        expect(readMiniMaxCodeState('global').lastCheckin).toEqual(record);
        expect(readMiniMaxCodeState('cn').lastCheckin).toBeUndefined();
    });

    it('今天已经签到时不重复领取', async () => {
        mocks.fetchCheckinStatus.mockResolvedValue({ checkedToday: true, streakDays: 5, points: 800, bonusPoints: 400 });
        await expect(runCheckin('manual')).resolves.toMatchObject({ status: 'already', points: 1200, streakDays: 5 });
        expect(mocks.claimCheckin).not.toHaveBeenCalled();
    });

    it('失败时记录错误，但不覆盖今天已有的成功记录', async () => {
        mocks.fetchCheckinStatus.mockRejectedValue(new Error('HTTP 502'));
        await expect(runCheckin('auto')).resolves.toMatchObject({ status: 'failed', error: 'HTTP 502' });
        expect(readMiniMaxCodeState().lastCheckin?.status).toBe('failed');

        const success = { date: checkinDate(), status: 'checked-in' as const, trigger: 'auto' as const, points: 1200, at: 'x' };
        updateMiniMaxCodeState((state) => ({ ...state, lastCheckin: success }));
        await runCheckin('manual');
        expect(readMiniMaxCodeState().lastCheckin).toEqual(success);
    });
});

describe('autoCheckinIfDue 与定时任务', () => {
    it('按配置和签到记录决定是否签到', async () => {
        mocks.fetchCheckinStatus.mockResolvedValue({ checkedToday: true, streakDays: 1, points: 1, bonusPoints: 0 });
        await autoCheckinIfDue();
        expect(mocks.withAccessToken).not.toHaveBeenCalled(); // 未登录

        updateMiniMaxCodeState(() => ({ account }));
        mocks.autoCheckin = false;
        await autoCheckinIfDue();
        expect(mocks.withAccessToken).not.toHaveBeenCalled();

        mocks.autoCheckin = undefined; // 默认开启
        await autoCheckinIfDue();
        expect(mocks.withAccessToken).toHaveBeenCalledTimes(1);
        expect(readMiniMaxCodeState().lastCheckin?.trigger).toBe('auto');

        await autoCheckinIfDue(); // 今天已签到
        expect(mocks.withAccessToken).toHaveBeenCalledTimes(1);
    });

    it('国际站按 minimaxCodeGlobal 的开关自动签到', async () => {
        updateMiniMaxCodeState(() => ({ account }), 'global');
        mocks.fetchCheckinStatus.mockResolvedValue({ checkedToday: true, streakDays: 1, points: 1, bonusPoints: 0 });
        await autoCheckinIfDue('global');
        expect(mocks.withAccessToken).toHaveBeenCalledWith('global', expect.any(Function));
    });

    it('启动后 1 分钟检查一次，之后每小时检查，重复启动不会创建多个定时器', async () => {
        vi.useFakeTimers();
        updateMiniMaxCodeState(() => ({ account }));
        mocks.fetchCheckinStatus.mockRejectedValue(new Error('network'));

        startCheckinScheduler();
        startCheckinScheduler();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(mocks.withAccessToken).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(60 * 60_000);
        expect(mocks.withAccessToken).toHaveBeenCalledTimes(2);
    });
});
