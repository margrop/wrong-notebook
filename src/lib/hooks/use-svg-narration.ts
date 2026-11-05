"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSpeechAudio, getSpeechMode, isSpeechAudioUnlocked, isSpeechReady, prepareSpeech, trackTtsUsed, unlockSpeechAudio } from "@/lib/cloud-speech";
import type { SpeechMode } from "@/lib/cloud-speech";
import type { NarrationSegment } from "@/lib/svg-animation";
import { findVoice, getSynth, isSpeechUnlocked, resetSpeechUnlockForTest, unlockSpeech } from "@/lib/svg-narration/browser-speech";
import type { SvgNarrationPlayback, SvgNarrationPlaybackDeps } from "@/lib/svg-narration/playback";
import { createSvgNarrationPlayback } from "@/lib/svg-narration/playback";
import { ENABLED_KEY, NARRATION_RATES, nextRate, RATE_KEY, readStorage, segmentIndexAt, writeStorage } from "@/lib/svg-narration/timing";

export { NARRATION_RATES, resetSpeechUnlockForTest, segmentIndexAt, unlockSpeech };

interface UseSvgNarrationOptions {
    segments: NarrationSegment[] | null;
    language: "zh" | "en";
    /** 所属错题，云端语音合成登记后台任务时用于说明和跳转 */
    errorItemId?: string;
    /** 上一段还没读完、画面已到下一段时暂停画面，读完后恢复 */
    holdAnimation: (hold: boolean) => void;
}

/** 查询朗读方式并跟踪语音列表：supported 表示当前语言可朗读 */
function useSpeechSupport(language: "zh" | "en") {
    const [supported, setSupported] = useState(false);
    const [mode, setMode] = useState<SpeechMode>("browser");
    const voiceRef = useRef<SpeechSynthesisVoice | undefined>(undefined);
    const modeRef = useRef<SpeechMode>("browser");

    useEffect(() => {
        let active = true;
        getSpeechMode().then((value) => {
            if (!active) return;
            modeRef.current = value;
            setMode(value);
        });
        return () => {
            active = false;
        };
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

    return { supported, mode, modeRef, voiceRef };
}

/**
 * SVG 动画的语音讲解：用浏览器的语音合成（Web Speech API）或服务端的云端语音（管理员在设置中选择）朗读讲解稿，
 * 云端语音失败时改用浏览器语音。由语音控制时间轴——
 * 播放到某段的 begin 时朗读该段；画面快到下一段而上一段还没读完时，先暂停画面，读完再继续。
 * 暂停或拖动进度时停止朗读，继续播放时从当前所在段的开头重新朗读。
 */
export function useSvgNarration({ segments, language, errorItemId, holdAnimation }: UseSvgNarrationOptions) {
    const { supported, mode, modeRef, voiceRef } = useSpeechSupport(language);
    const [enabled, setEnabledState] = useState(false);
    const [rate, setRateState] = useState<number>(1);
    // 正在朗读、画面在等待朗读，供播放器在外框提示
    const [speaking, setSpeaking] = useState(false);
    const [holding, setHolding] = useState(false);
    // 用户在本页手动开关过语音后，不再按是否已生成语音自动开启
    const userToggledRef = useRef(false);
    const enabledRef = useRef(false);
    const rateRef = useRef(1);
    const holdRef = useRef(holdAnimation);

    useEffect(() => {
        holdRef.current = holdAnimation;
    }, [holdAnimation]);

    // 匿名埋点：开始朗读时记录朗读方式（每个会话每种方式一次）
    useEffect(() => {
        if (speaking) trackTtsUsed();
    }, [speaking]);

    useEffect(() => {
        enabledRef.current = readStorage(ENABLED_KEY) === "1";
        setEnabledState(enabledRef.current);
        const savedRate = Number(readStorage(RATE_KEY));
        if ((NARRATION_RATES as readonly number[]).includes(savedRate)) {
            rateRef.current = savedRate;
            setRateState(savedRate);
        }
    }, []);

    // 播放控制对象与可变 deps 各创建一次，在 mount effect 中初始化；
    // deps 经 ref 持有，每次渲染后在 effect 中同步最新值
    const playbackRef = useRef<{ playback: SvgNarrationPlayback; deps: SvgNarrationPlaybackDeps } | null>(null);

    // 每次渲染后同步 playback 依赖的最新值（playback 的回调在事件中读取）
    useEffect(() => {
        const current = playbackRef.current;
        if (!current) return;
        current.deps.segments = segments;
        current.deps.language = language;
        current.deps.enabled = enabledRef.current;
        current.deps.mode = modeRef.current;
        current.deps.voice = voiceRef.current;
        current.deps.rate = rateRef.current;
    });

    // 初始化播放控制对象；卸载时清理
    useEffect(() => {
        const deps: SvgNarrationPlaybackDeps = {
            segments,
            language,
            enabled: enabledRef.current,
            mode: modeRef.current,
            voice: voiceRef.current,
            rate: rateRef.current,
            setSpeaking,
            setHolding,
            hold: (value: boolean) => { holdRef.current(value); },
        };
        const instance = createSvgNarrationPlayback(deps);
        playbackRef.current = { playback: instance, deps };
        return () => {
            instance.dispose();
            playbackRef.current = null;
        };
        // 仅在挂载时创建一次；segments/language 等经 deps 同步 effect 更新
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const getPlayback = useCallback(() => playbackRef.current?.playback ?? null, []);

    // 换了动画或离开页面时停止朗读
    useEffect(() => () => { getPlayback()?.dispose(); }, [segments, getPlayback]);

    /** 停止朗读；time 为当前（或拖动到的）时间，继续播放时从该时间所在段重新朗读 */
    const stop = useCallback((time: number) => { getPlayback()?.stop(time); }, [getPlayback]);

    /** 播放中每帧调用：进入新的段时朗读；上一段未读完、画面快到下一段时暂停等待 */
    const update = useCallback((time: number) => { getPlayback()?.update(time); }, [getPlayback]);

    /** 在用户点击（开启语音、播放、重播）时调用，解锁 iOS 上的朗读 */
    const prime = useCallback(() => {
        if (!enabledRef.current) return;
        unlockSpeech();
        if (modeRef.current === "cloud") unlockSpeechAudio();
    }, [modeRef]);

    const setEnabled = useCallback((value: boolean, time: number) => {
        userToggledRef.current = true;
        getPlayback()?.stop(time);
        enabledRef.current = value;
        setEnabledState(value);
        writeStorage(ENABLED_KEY, value ? "1" : "0");
        prime();
    }, [getPlayback, prime]);

    const cycleRate = useCallback(() => {
        const next = nextRate(rateRef.current);
        rateRef.current = next;
        setRateState(next);
        if (modeRef.current === "cloud") {
            const audio = getSpeechAudio();
            if (audio) audio.playbackRate = next;
        }
        writeStorage(RATE_KEY, String(next));
    }, [modeRef]);

    // 已开启语音但本页还没解锁时（如记住了开启状态、动画自动播放），在页面上的下一次点击中解锁
    useEffect(() => {
        const needsAudio = mode === "cloud" && !isSpeechAudioUnlocked();
        if (!enabled || ((isSpeechUnlocked() || !getSynth()) && !needsAudio)) return;
        const handle = () => {
            unlockSpeech();
            if (needsAudio) unlockSpeechAudio();
        };
        document.addEventListener("click", handle, { capture: true, once: true });
        document.addEventListener("touchend", handle, { capture: true, once: true });
        return () => {
            document.removeEventListener("click", handle, { capture: true });
            document.removeEventListener("touchend", handle, { capture: true });
        };
    }, [enabled, mode]);

    // 开启云端语音后一次合成全部段落（服务端登记为后台任务），播放时不用逐段等待
    useEffect(() => {
        if (!enabled || mode !== "cloud" || !segments?.length) return;
        prepareSpeech(segments.map((segment) => segment.text), language, errorItemId).catch(() => undefined);
    }, [enabled, mode, segments, language, errorItemId]);

    // 已生成云端语音的动画默认开启语音讲解（不改变记住的开关设置）
    useEffect(() => {
        if (mode !== "cloud" || !segments?.length || enabledRef.current) return;
        let active = true;
        isSpeechReady(segments.map((segment) => segment.text), language).then((ready) => {
            if (!active || !ready || enabledRef.current || userToggledRef.current) return;
            enabledRef.current = true;
            setEnabledState(true);
        });
        return () => {
            active = false;
        };
    }, [mode, segments, language]);

    return { supported: supported || mode === "cloud", enabled, rate, speaking, holding, setEnabled, cycleRate, update, stop, prime };
}
