"use client";

import { apiClient } from "@/lib/api-client";

/**
 * 云端语音（服务端语音合成）的前端部分：查询朗读方式、请求合成、用同一个 audio 元素播放。
 * iOS Safari 只允许在用户点击中开始播放；在点击中用这个元素播一段静音解锁后，之后换音频自动播放也能出声。
 */

export type SpeechMode = "browser" | "cloud";

let modePromise: Promise<SpeechMode> | null = null;

/** 当前的朗读方式（整页只查询一次）；未登录或查询失败时用浏览器语音 */
export function getSpeechMode(): Promise<SpeechMode> {
    modePromise ??= apiClient.get<{ mode?: string }>("/api/tts")
        .then((res) => (res.mode === "cloud" ? "cloud" : "browser") as SpeechMode)
        .catch(() => "browser" as SpeechMode);
    return modePromise;
}

let audioElement: HTMLAudioElement | null = null;
let audioUnlocked = false;

export function getSpeechAudio(): HTMLAudioElement | null {
    if (typeof window === "undefined" || typeof Audio === "undefined") return null;
    audioElement ??= new Audio();
    return audioElement;
}

/** 0.1 秒的静音 WAV，用于在点击中解锁播放 */
function silentWavUrl(): string {
    const sampleRate = 8000;
    const samples = 800;
    const view = new DataView(new ArrayBuffer(44 + samples * 2));
    const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + samples * 2, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, samples * 2, true);
    let binary = "";
    new Uint8Array(view.buffer).forEach((byte) => { binary += String.fromCharCode(byte); });
    return `data:audio/wav;base64,${btoa(binary)}`;
}

/** 在用户点击中调用：播放一段静音解锁 audio 元素（整个页面只需一次） */
export function unlockSpeechAudio() {
    const audio = getSpeechAudio();
    if (!audio || audioUnlocked) return;
    audioUnlocked = true;
    audio.src = silentWavUrl();
    audio.play().catch(() => {
        // 没有在点击中调用时会被拒绝，下次点击再试
        audioUnlocked = false;
    });
}

export function isSpeechAudioUnlocked() {
    return audioUnlocked;
}

/** 合成过的讲解：同一页面内同样的文字只请求一次 */
const speechUrls = new Map<string, Promise<string>>();

const speechKey = (text: string, language: "zh" | "en") => `${language}\n${text}`;

function postSpeech(text: string, language: "zh" | "en", regenerate: boolean): Promise<string> {
    return apiClient.post<{ id: string; version: number }>("/api/tts", { text, language, ...(regenerate ? { regenerate } : {}) }, { timeout: 120000, recoverable: true })
        .then(({ id, version }) => `/api/tts/${id}?v=${version}`);
}

/** 请求服务端合成一段讲解，返回音频地址；失败时清除记录，下次重新请求 */
export function requestSpeech(text: string, language: "zh" | "en"): Promise<string> {
    const key = speechKey(text, language);
    let url = speechUrls.get(key);
    if (!url) {
        url = postSpeech(text, language, false);
        url.catch(() => speechUrls.delete(key));
        speechUrls.set(key, url);
    }
    return url;
}

/**
 * 逐段重新合成讲解语音（忽略服务端缓存），之后播放使用新的语音；onProgress 报告已完成的段数。
 * 某段失败时停止并抛出错误，已完成的段保留新语音
 */
export async function regenerateSpeech(texts: string[], language: "zh" | "en", onProgress?: (done: number) => void): Promise<void> {
    for (let i = 0; i < texts.length; i++) {
        const url = postSpeech(texts[i], language, true);
        speechUrls.set(speechKey(texts[i], language), url);
        await url.catch((error: unknown) => {
            speechUrls.delete(speechKey(texts[i], language));
            throw error;
        });
        onProgress?.(i + 1);
    }
}

/** 仅供测试：重置模块状态 */
export function resetCloudSpeechForTest() {
    modePromise = null;
    audioElement = null;
    audioUnlocked = false;
    speechUrls.clear();
}
