"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/error-message";
import { frontendLogger } from "@/lib/frontend-logger";
import { DEFAULT_MOBILE_NAV_FOURTH, isMobileNavFourth, type MobileNavFourth } from "@/lib/mobile-nav";
import type { UserProfile } from "@/types/api";

export const MOBILE_NAV_STORAGE_KEY = "mobile-nav-fourth";

interface MobileNavContextValue {
    fourth: MobileNavFourth;
    loaded: boolean;
    setFourth: (value: MobileNavFourth) => Promise<void>;
}

const MobileNavContext = createContext<MobileNavContextValue>({
    fourth: DEFAULT_MOBILE_NAV_FOURTH,
    loaded: false,
    setFourth: async () => undefined,
});

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", listener);
    };
}

function readStoredFourth(): MobileNavFourth {
    try {
        const stored = localStorage.getItem(MOBILE_NAV_STORAGE_KEY);
        return isMobileNavFourth(stored) ? stored : DEFAULT_MOBILE_NAV_FOURTH;
    } catch {
        return DEFAULT_MOBILE_NAV_FOURTH;
    }
}

function writeStoredFourth(value: MobileNavFourth) {
    try {
        localStorage.setItem(MOBILE_NAV_STORAGE_KEY, value);
    } catch {
        // 存储不可用时仍让当前页面的状态生效。
    }
    listeners.forEach((listener) => listener());
}

/** 加载并保存按账号同步的手机底部导航偏好。 */
export function MobileNavProvider({ children }: { children: ReactNode }) {
    const { data: session, status } = useSession();
    const authenticated = status === "authenticated";
    const accountEmail = session?.user?.email;
    const fourth = useSyncExternalStore(subscribe, readStoredFourth, () => DEFAULT_MOBILE_NAV_FOURTH);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!authenticated || !accountEmail) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- 登录状态变化后更新偏好加载状态
            setLoaded(status !== "loading");
            return;
        }

        let cancelled = false;
        setLoaded(false);
        apiClient.get<UserProfile>("/api/user")
            .then((user) => {
                if (!cancelled && isMobileNavFourth(user.mobileNavFourth)) {
                    writeStoredFourth(user.mobileNavFourth);
                }
            })
            .catch((error: unknown) => {
                frontendLogger.warn("[MobileNav]", "Failed to load mobile navigation preference", { error: getErrorMessage(error) });
            })
            .finally(() => {
                if (!cancelled) setLoaded(true);
            });

        return () => {
            cancelled = true;
        };
    }, [accountEmail, authenticated, status]);

    const setFourth = useCallback(async (value: MobileNavFourth) => {
        const previous = readStoredFourth();
        writeStoredFourth(value);
        if (!authenticated) return;
        try {
            await apiClient.patch("/api/user", { mobileNavFourth: value });
        } catch (error) {
            writeStoredFourth(previous);
            throw error;
        }
    }, [authenticated]);

    const value = useMemo(() => ({ fourth, loaded, setFourth }), [fourth, loaded, setFourth]);
    return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

export function useMobileNav(): MobileNavContextValue {
    return useContext(MobileNavContext);
}
