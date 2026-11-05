"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// 本机浏览器保存的界面选择（如录入方式、裁剪模式）。
// 无痕模式等无法读写 localStorage 时，退回内存，只在本次打开期间生效。
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function readRaw(key: string): string | null {
    if (memory.has(key)) return memory.get(key) ?? null;
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

/** 写入本机保存的值，并通知所有读取同一键的组件 */
export function writeStoredRaw(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
        memory.delete(key);
    } catch {
        memory.set(key, value);
    }
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    // 其他标签页修改时同步
    window.addEventListener("storage", listener);
    return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", listener);
    };
}

/**
 * 读写本机保存的值：服务端渲染和水合阶段使用 parse(null) 的默认值，挂载后换成保存的值，
 * 避免两端输出不一致。parse 需能处理 null 与任意不合法的字符串。
 */
export function useStoredValue<T>(key: string, parse: (raw: string | null) => T, serialize: (value: T) => string): [T, (value: T) => void] {
    const raw = useSyncExternalStore(subscribe, () => readRaw(key), () => null);
    const value = useMemo(() => parse(raw), [parse, raw]);
    const setValue = useCallback((next: T) => writeStoredRaw(key, serialize(next)), [key, serialize]);
    return [value, setValue];
}

const identity = (value: string) => value;

/** 记住上次在若干选项中的选择；保存的值不在 options（需为模块级常量）中时回退 fallback */
export function useStoredChoice<T extends string>(key: string, options: readonly T[], fallback: T): [T, (value: T) => void] {
    const parse = useCallback(
        (raw: string | null): T => (options as readonly string[]).includes(raw ?? "") ? raw as T : fallback,
        [options, fallback],
    );
    return useStoredValue<T>(key, parse, identity);
}
