"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/error-message";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import type { LoginPollResult } from "@/lib/minimax-code/auth";
import type { MiniMaxCodeCheckinRecord } from "@/lib/minimax-code/store";
import type { MiniMaxCodeStatus } from "@/lib/minimax-code/status";

export type PendingLogin = NonNullable<MiniMaxCodeStatus['pendingLogin']>;

/** MiniMax Code 账号：读取状态、网页登录（打开授权页并轮询结果）、退出登录、立即签到 */
export function useMiniMaxCodeAccount() {
    const { t } = useLanguage();
    const texts = t.settings?.ai?.minimaxCode;
    const [status, setStatus] = useState<MiniMaxCodeStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState<PendingLogin | null>(null);
    const [busy, setBusy] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const next = await apiClient.get<MiniMaxCodeStatus>('/api/minimax-code');
            setStatus(next);
            if (next.pendingLogin) setPending(next.pendingLogin);
        } catch (error) {
            frontendLogger.error('[MiniMaxCode]', 'Failed to load status', { error });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时读取账号状态
        void refresh();
    }, [refresh]);

    // 有待授权的登录时按服务端给的间隔轮询，直到授权完成、超时或被拒绝
    useEffect(() => {
        if (!pending) return;
        let cancelled = false;
        const poll = async () => {
            try {
                const result = await apiClient.get<LoginPollResult>('/api/minimax-code/login');
                if (cancelled) return;
                if (result.status === 'pending') {
                    timer.current = setTimeout(poll, pending.intervalMs);
                    return;
                }
                setPending(null);
                if (result.status === 'ok') toast.success(texts?.loginSuccess || 'Signed in');
                else if (result.status === 'expired') toast.error(texts?.loginExpired || 'Authorization timed out');
                else if (result.status === 'denied') toast.error(texts?.loginDenied || 'Authorization declined');
                void refresh();
            } catch (error) {
                if (cancelled) return;
                setPending(null);
                toast.error(`${texts?.loginFailed || 'Sign-in failed'}: ${getErrorMessage(error)}`);
            }
        };
        timer.current = setTimeout(poll, pending.intervalMs);
        return () => {
            cancelled = true;
            if (timer.current) clearTimeout(timer.current);
        };
    }, [pending, refresh, texts]);

    const login = async () => {
        setBusy(true);
        try {
            const next = await apiClient.post<PendingLogin>('/api/minimax-code/login', {});
            setPending(next);
            // 弹窗可能被浏览器拦截，界面上同时提供授权链接
            window.open(next.url, '_blank', 'noopener,noreferrer');
        } catch (error) {
            toast.error(`${texts?.loginFailed || 'Sign-in failed'}: ${getErrorMessage(error)}`);
        } finally {
            setBusy(false);
        }
    };

    const logout = async () => {
        setBusy(true);
        try {
            await apiClient.delete('/api/minimax-code');
            setPending(null);
            await refresh();
        } catch (error) {
            toast.error(getErrorMessage(error));
        } finally {
            setBusy(false);
        }
    };

    const checkin = async () => {
        setBusy(true);
        try {
            const record = await apiClient.post<MiniMaxCodeCheckinRecord>('/api/minimax-code/checkin', {});
            if (record.status === 'failed') {
                toast.error((texts?.checkinFailed || 'Check-in failed: {error}').replace('{error}', record.error || ''));
            } else {
                toast.success(texts?.checkinSuccess || 'Checked in');
            }
            await refresh();
        } catch (error) {
            toast.error(getErrorMessage(error));
        } finally {
            setBusy(false);
        }
    };

    return { status, loading, pending, busy, refresh, login, logout, checkin };
}
