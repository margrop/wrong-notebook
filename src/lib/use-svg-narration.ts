"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NarrationSegment } from "@/lib/svg-animation";

export const NARRATION_RATES = [1, 1.25, 1.5, 0.75] as const;

const ENABLED_KEY = "svg-narration-enabled";
const RATE_KEY = "svg-narration-rate";

function readStorage(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // 无痕模式等无法写入时只在本次会话生效
    }
}

/** 语音合成的语言代码前缀（安卓系统的中文语音可能为 cmn） */
const VOICE_LANG_PREFIXES: Record<"zh" | "en", string[]> = { zh: ["zh", "cmn"], en: ["en"] };

function getSynth(): SpeechSynthesis | null {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined"
        ? window.speechSynthesis
        : null;
}

function findVoice(voices: SpeechSynthesisVoice[], language: "zh" | "en"): SpeechSynthesisVoice | undefined {
    const prefixes = VOICE_LANG_PREFIXES[language];
    const matches = voices.filter((voice) => prefixes.some((prefix) => voice.lang.toLowerCase().startsWith(prefix)));
    const preferred = language === "zh" ? /^(zh|cmn)[-_](cn|hans)/i : /^en[-_]us/i;
    return matches.find((voice) => preferred.test(voice.lang) && voice.localService)
        ?? matches.find((voice) => preferred.test(voice.lang))
        ?? matches[0];
}

/** time 所在的讲解段（最后一个 begin ≤ time 的段），在第一段之前为 -1 */
export function segmentIndexAt(segments: NarrationSegment[], time: number): number {
    let index = -1;
    for (let i = 0; i < segments.length && segments[i].begin <= time + 0.05; i++) index = i;
    return index;
}

interface UseSvgNarrationOptions {
    segments: NarrationSegment[] | null;
    language: "zh" | "en";
    /** 上一段还没读完、画面已到下一段时暂停画面，读完后恢复 */
    holdAnimation: (hold: boolean) => void;
}

/**
 * SVG 动画的语音讲解：用浏览器的语音合成（Web Speech API）朗读讲解稿，由语音控制时间轴——
 * 播放到某段的 begin 时朗读该段；画面到了下一段而上一段还没读完时，先暂停画面，读完再继续。
 * 暂停或拖动进度时停止朗读，继续播放时从当前所在段的开头重新朗读。
 */
export function useSvgNarration({ segments, language, holdAnimation }: UseSvgNarrationOptions) {
    const [supported, setSupported] = useState(false);
    const [enabled, setEnabledState] = useState(false);
    const [rate, setRateState] = useState<number>(1);
    const voiceRef = useRef<SpeechSynthesisVoice | undefined>(undefined);
    // 已开始朗读的段；-1 表示还没有
    const spokenRef = useRef(-1);
    const speakingRef = useRef(false);
    // 画面因等待朗读而暂停时，等待的段
    const waitingRef = useRef<number | null>(null);
    // 每次停止后递增，忽略已取消朗读的 onend 回调
    const generationRef = useRef(0);
    // 保留当前 utterance 的引用，避免部分浏览器回收后不触发 onend
    const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
    const enabledRef = useRef(false);
    const rateRef = useRef(1);
    const holdRef = useRef(holdAnimation);

    useEffect(() => {
        holdRef.current = holdAnimation;
    }, [holdAnimation]);

    useEffect(() => {
        enabledRef.current = readStorage(ENABLED_KEY) === "1";
        setEnabledState(enabledRef.current);
        const savedRate = Number(readStorage(RATE_KEY));
        if ((NARRATION_RATES as readonly number[]).includes(savedRate)) {
            rateRef.current = savedRate;
            setRateState(savedRate);
        }
    }, []);

    // 语音列表可能异步加载；列表非空但没有该语言的语音时视为不支持
    useEffect(() => {
        // 不支持语音合成时保持初始的不可用状态
        const synth = getSynth();
        if (!synth) return;
        const update = () => {
            const voices = synth.getVoices();
            voiceRef.current = findVoice(voices, language);
            setSupported(voices.length === 0 || !!voiceRef.current);
        };
        update();
        synth.addEventListener?.("voiceschanged", update);
        return () => synth.removeEventListener?.("voiceschanged", update);
    }, [language]);

    const speak = useCallback((index: number) => {
        const synth = getSynth();
        const segment = segments?.[index];
        if (!synth || !segment) return;
        const generation = generationRef.current;
        const utterance = new SpeechSynthesisUtterance(segment.text);
        utterance.lang = voiceRef.current?.lang ?? (language === "en" ? "en-US" : "zh-CN");
        if (voiceRef.current) utterance.voice = voiceRef.current;
        utterance.rate = rateRef.current;
        // 读完后若画面在等待，恢复播放，下一帧由 update 朗读等待的段
        const finish = () => {
            if (generation !== generationRef.current || utteranceRef.current !== utterance) return;
            utteranceRef.current = null;
            speakingRef.current = false;
            if (waitingRef.current === null) return;
            waitingRef.current = null;
            holdRef.current(false);
        };
        utterance.onend = finish;
        utterance.onerror = finish;
        utteranceRef.current = utterance;
        speakingRef.current = true;
        synth.speak(utterance);
    }, [segments, language]);

    /** 停止朗读；time 为当前（或拖动到的）时间，继续播放时从该时间所在段重新朗读 */
    const stop = useCallback((time: number) => {
        generationRef.current++;
        utteranceRef.current = null;
        speakingRef.current = false;
        if (waitingRef.current !== null) {
            waitingRef.current = null;
            holdRef.current(false);
        }
        spokenRef.current = segments ? segmentIndexAt(segments, time) - 1 : -1;
        getSynth()?.cancel();
    }, [segments]);

    /** 播放中每帧调用：进入新的段时朗读，上一段未读完则暂停画面等待 */
    const update = useCallback((time: number) => {
        if (!enabledRef.current || !segments?.length || waitingRef.current !== null) return;
        const index = segmentIndexAt(segments, time);
        if (index <= spokenRef.current) return;
        if (speakingRef.current) {
            waitingRef.current = index;
            holdRef.current(true);
            return;
        }
        spokenRef.current = index;
        speak(index);
    }, [segments, speak]);

    const setEnabled = useCallback((value: boolean, time: number) => {
        stop(time);
        enabledRef.current = value;
        setEnabledState(value);
        writeStorage(ENABLED_KEY, value ? "1" : "0");
    }, [stop]);

    const cycleRate = useCallback(() => {
        const next = NARRATION_RATES[(NARRATION_RATES.indexOf(rateRef.current as typeof NARRATION_RATES[number]) + 1) % NARRATION_RATES.length];
        rateRef.current = next;
        setRateState(next);
        writeStorage(RATE_KEY, String(next));
    }, []);

    // 换了动画或离开页面时停止朗读
    useEffect(() => () => {
        generationRef.current++;
        getSynth()?.cancel();
    }, [segments]);

    return { supported, enabled, rate, setEnabled, cycleRate, update, stop };
}
