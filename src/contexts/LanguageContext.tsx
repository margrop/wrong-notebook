"use client";

import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { zh } from '@/lib/i18n/zh';
import type { Translations, Language } from '@/lib/translations';

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: Translations;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = 'app-language';
const DEFAULT_LANGUAGE: Language = 'zh';

// 界面语言保存在 localStorage，作为外部状态订阅；本页切换时通知订阅者，其他标签页切换时由 storage 事件通知
const languageListeners = new Set<() => void>();

function subscribeLanguage(listener: () => void) {
    languageListeners.add(listener);
    window.addEventListener('storage', listener);
    return () => {
        languageListeners.delete(listener);
        window.removeEventListener('storage', listener);
    };
}

function readLanguage(): Language {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'zh' || saved === 'en' ? saved : DEFAULT_LANGUAGE;
}

// 英文文案按需加载：模块级缓存 Promise 与结果，只加载一次，之后挂载的组件可直接同步取用
let enTranslationPromise: Promise<Translations> | null = null;
let loadedEnTranslations: Translations | null = null;
export function loadEnTranslations(): Promise<Translations> {
    if (!enTranslationPromise) {
        enTranslationPromise = import('@/lib/i18n/en').then((mod) => {
            loadedEnTranslations = mod.en;
            return mod.en;
        });
    }
    return enTranslationPromise;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    // 服务端渲染与水合阶段使用默认语言，之后读取保存的语言
    const language = useSyncExternalStore(subscribeLanguage, readLanguage, () => DEFAULT_LANGUAGE);
    const [enTranslations, setEnTranslations] = useState<Translations | null>(() => loadedEnTranslations);

    useEffect(() => {
        if (language === 'en' && enTranslations === null) {
            let cancelled = false;
            loadEnTranslations().then((loaded) => {
                if (!cancelled) setEnTranslations(loaded);
            });
            return () => { cancelled = true; };
        }
    }, [language, enTranslations]);

    const handleSetLanguage = (lang: Language) => {
        localStorage.setItem(STORAGE_KEY, lang);
        languageListeners.forEach((listener) => listener());
    };

    // 英文文案尚未加载完成时先回退到中文，避免整页闪白
    const t = language === 'en' && enTranslations ? enTranslations : zh;

    const value = {
        language,
        setLanguage: handleSetLanguage,
        t,
    };

    return (
        <LanguageContext.Provider value={value}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (context === undefined) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
}
