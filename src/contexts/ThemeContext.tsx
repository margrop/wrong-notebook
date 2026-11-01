"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/error-message";
import { frontendLogger } from "@/lib/frontend-logger";
import { DEFAULT_THEME_PREFERENCE, isThemePreference, resolveTheme, THEME_STORAGE_KEY } from "@/lib/theme";
import type { ThemePreference } from "@/lib/theme";
import type { UserProfile } from "@/types/api";

interface ThemeContextValue {
    /** 用户选择的偏好 */
    preference: ThemePreference;
    /** 实际使用的主题 */
    theme: "light" | "dark";
    setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
    preference: DEFAULT_THEME_PREFERENCE,
    theme: "light",
    setPreference: () => undefined,
});

const DARK_QUERY = "(prefers-color-scheme: dark)";

// 偏好缓存在 localStorage，作为外部状态订阅；本页修改时通知订阅者，其他标签页修改时由 storage 事件通知
const preferenceListeners = new Set<() => void>();

function subscribePreference(listener: () => void) {
    preferenceListeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
        preferenceListeners.delete(listener);
        window.removeEventListener("storage", listener);
    };
}

function readPreference(): ThemePreference {
    try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        return isThemePreference(saved) ? saved : DEFAULT_THEME_PREFERENCE;
    } catch {
        return DEFAULT_THEME_PREFERENCE;
    }
}

function writePreference(preference: ThemePreference) {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
        // 存储不可用时只在本次访问内生效
    }
    preferenceListeners.forEach((listener) => listener());
}

function subscribeSystemDark(listener: () => void) {
    const media = window.matchMedia(DARK_QUERY);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
}

const readSystemDark = () => window.matchMedia(DARK_QUERY).matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
    const { data: session, status } = useSession();
    const authenticated = status === "authenticated";
    const accountEmail = session?.user?.email;
    // 服务端渲染与水合阶段按默认值，之后读取本地缓存；首屏的 dark 类已由 <head> 中的脚本设置
    const preference = useSyncExternalStore(subscribePreference, readPreference, () => DEFAULT_THEME_PREFERENCE);
    const systemDark = useSyncExternalStore(subscribeSystemDark, readSystemDark, () => false);
    const theme = resolveTheme(preference, systemDark);

    useEffect(() => {
        const root = document.documentElement;
        const applyTheme = (mode: "light" | "dark") => {
            root.classList.toggle("dark", mode === "dark");
            root.style.colorScheme = mode;
        };
        applyTheme(theme);

        // 打印时临时切回浅色，防止浏览器按深色主题渲染出接近透明的浅色文字
        const handleBeforePrint = () => applyTheme("light");
        const handleAfterPrint = () => applyTheme(theme);
        window.addEventListener("beforeprint", handleBeforePrint);
        window.addEventListener("afterprint", handleAfterPrint);
        return () => {
            window.removeEventListener("beforeprint", handleBeforePrint);
            window.removeEventListener("afterprint", handleAfterPrint);
        };
    }, [theme]);

    // 登录后以账号中保存的偏好为准，换设备或换账号时保持一致
    useEffect(() => {
        if (!authenticated || !accountEmail) return;
        let cancelled = false;
        apiClient.get<UserProfile>("/api/user")
            .then((user) => {
                if (!cancelled && isThemePreference(user.themePreference) && user.themePreference !== readPreference()) {
                    writePreference(user.themePreference);
                }
            })
            .catch((error: unknown) => {
                frontendLogger.warn("[Theme]", "Failed to load theme preference", { error: getErrorMessage(error) });
            });
        return () => {
            cancelled = true;
        };
    }, [authenticated, accountEmail]);

    const setPreference = useCallback((next: ThemePreference) => {
        writePreference(next);
        if (!authenticated) return;
        apiClient.patch("/api/user", { themePreference: next }).catch((error: unknown) => {
            // 保存失败时本机仍按新偏好显示，下次登录以账号中的偏好为准
            frontendLogger.warn("[Theme]", "Failed to save theme preference", { error: getErrorMessage(error) });
        });
    }, [authenticated]);

    const value = useMemo(() => ({ preference, theme, setPreference }), [preference, theme, setPreference]);
    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
    return useContext(ThemeContext);
}
