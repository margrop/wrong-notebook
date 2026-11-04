/**
 * SVG 动画语音讲解的纯工具函数：不依赖 React，可单独测试。
 */

import type { NarrationSegment } from "@/lib/svg-animation";

export const NARRATION_RATES = [1, 1.25, 1.5, 0.75] as const;

const ENABLED_KEY = "svg-narration-enabled";
const RATE_KEY = "svg-narration-rate";

export function readStorage(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

export function writeStorage(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // 无痕模式等无法写入时只在本次会话生效
    }
}

export { ENABLED_KEY, RATE_KEY };

/** 按文字长度估计的最长朗读时长（毫秒），超过后视为读完，防止浏览器不触发 onend 时画面一直等待 */
export function maxSpeakingMs(text: string, rate: number): number {
    return Math.max(8000, (text.length * 400) / rate + 5000);
}

/** time 所在的讲解段（最后一个 begin ≤ time 的段），在第一段之前为 -1 */
export function segmentIndexAt(segments: NarrationSegment[], time: number): number {
    let index = -1;
    for (let i = 0; i < segments.length && segments[i].begin <= time + 0.05; i++) index = i;
    return index;
}

/**
 * 等待朗读时提前暂停的秒数：在下一段开始前、换步的淡入淡出之前停下，画面停在上一步完整的样子，
 * 不会停在两步之间半透明的过渡中
 */
export const HOLD_LEAD_S = 0.8;

/** 朗读开始的最长等待；超时（如 iOS 未解锁时被静默拦截）视为读完，避免画面一直等待 */
export const START_TIMEOUT_MS = 2500;
/** 云端语音下载后开始播放的最长等待 */
export const AUDIO_START_TIMEOUT_MS = 8000;
/** 云端语音合成超过这个时间还没开始播放时，暂停画面等待，避免画面跑在语音前面 */
export const LOADING_HOLD_DELAY_MS = 300;

/** 语速循环切换的下一个值 */
export function nextRate(current: number): number {
    const index = (NARRATION_RATES as readonly number[]).indexOf(current as (typeof NARRATION_RATES)[number]);
    return NARRATION_RATES[(index + 1) % NARRATION_RATES.length];
}
