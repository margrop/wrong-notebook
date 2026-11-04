/**
 * MiniMax Code 登录凭据与签到记录，保存在配置目录的 minimax-code.json（与 app-config.json 同目录，不入库）。
 * 单独存放是因为 refresh token 一次性轮换：刷新后必须立即落盘，不能被设置页保存整份配置时覆盖。
 */

import "server-only";

import fs from 'fs';
import path from 'path';
import type { DeviceLogin } from './api';

export interface MiniMaxCodeAccount {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string;
    userId: string | null;
    name: string | null;
    email: string | null;
    loggedInAt: string;
    /** refresh token 被服务端拒绝，需要重新登录 */
    invalid?: boolean;
}

export interface MiniMaxCodeCheckinRecord {
    /** 签到日（北京时间）yyyy-MM-dd */
    date: string;
    status: 'checked-in' | 'already' | 'failed';
    /** auto：定时任务自动签到；manual：在设置页手动签到 */
    trigger: 'auto' | 'manual';
    points?: number;
    streakDays?: number;
    error?: string;
    at: string;
}

export interface MiniMaxCodeState {
    account?: MiniMaxCodeAccount;
    pendingLogin?: DeviceLogin;
    lastCheckin?: MiniMaxCodeCheckinRecord;
}

function stateFilePath(): string {
    return path.join(process.env.CONFIG_DIR || path.join(process.cwd(), 'config'), 'minimax-code.json');
}

export function readMiniMaxCodeState(): MiniMaxCodeState {
    try {
        const parsed = JSON.parse(fs.readFileSync(stateFilePath(), 'utf-8'));
        return parsed && typeof parsed === 'object' ? parsed as MiniMaxCodeState : {};
    } catch {
        return {};
    }
}

/** 读取、修改并原子写回；返回写入后的状态 */
export function updateMiniMaxCodeState(update: (state: MiniMaxCodeState) => MiniMaxCodeState): MiniMaxCodeState {
    const next = update(readMiniMaxCodeState());
    const file = stateFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return next;
}
