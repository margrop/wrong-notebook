/**
 * SVG 动画语音讲解的播放控制：分段朗读、播放队列、云端 TTS 与浏览器语音回退。
 * 不依赖 React，通过可变 deps 对象注入状态，供 useSvgNarration 使用。
 */

import { getSpeechAudio, requestSpeech } from "@/lib/cloud-speech";
import type { SpeechMode } from "@/lib/cloud-speech";
import type { NarrationSegment } from "@/lib/svg-animation";
import { getSynth } from "@/lib/svg-narration/browser-speech";
import { AUDIO_START_TIMEOUT_MS, HOLD_LEAD_S, LOADING_HOLD_DELAY_MS, maxSpeakingMs, segmentIndexAt, START_TIMEOUT_MS } from "@/lib/svg-narration/timing";

/**
 * 播放控制的依赖项。可变对象：hook 每次渲染更新字段，playback 内部读取最新值。
 * 不用 React ref，避免 hooks lint 对渲染期间访问的限制。
 */
export interface SvgNarrationPlaybackDeps {
    segments: NarrationSegment[] | null;
    language: "zh" | "en";
    enabled: boolean;
    mode: SpeechMode;
    voice: SpeechSynthesisVoice | undefined;
    rate: number;
    setSpeaking: (value: boolean) => void;
    setHolding: (value: boolean) => void;
    hold: (hold: boolean) => void;
}

export interface SvgNarrationPlayback {
    /** 播放中每帧调用：进入新的段时朗读；上一段未读完、画面快到下一段时暂停等待 */
    update: (time: number) => void;
    /** 停止朗读；time 为当前（或拖动到的）时间，继续播放时从该时间所在段重新朗读 */
    stop: (time: number) => void;
    /** 组件卸载或换动画时清理：取消朗读与音频 */
    dispose: () => void;
}

export function createSvgNarrationPlayback(deps: SvgNarrationPlaybackDeps): SvgNarrationPlayback {
    // 已开始朗读的段；-1 表示还没有
    let spoken = -1;
    let speaking = false;
    // 画面因等待朗读而暂停时，等待的段
    let waiting: number | null = null;
    // 每次停止后递增，忽略已取消朗读的 onend 回调
    let generation = 0;
    // 正在朗读的段的标记，旧段的回调据此忽略
    let active: object | null = null;
    // 保留当前 utterance 的引用，避免部分浏览器回收后不触发 onend
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 仅持有引用，不读取
    let utterance: SpeechSynthesisUtterance | null = null;
    // 云端语音还在合成、画面暂停等待时为 true
    let loadingHold = false;
    // 每段朗读是否已回退到浏览器语音（云端失败时只回退一次）
    let usedLocal = false;

    /** 取消因等待云端语音合成而暂停的画面 */
    function releaseLoadingHold() {
        if (!loadingHold) return;
        loadingHold = false;
        if (waiting !== null) return;
        deps.setHolding(false);
        deps.hold(false);
    }

    function finish(current: () => boolean, clearWatchdog: () => void) {
        clearWatchdog();
        if (!current()) return;
        active = null;
        utterance = null;
        speaking = false;
        deps.setSpeaking(false);
        releaseLoadingHold();
        if (waiting === null) return;
        waiting = null;
        deps.setHolding(false);
        deps.hold(false);
    }

    function speakLocal(
        current: () => boolean,
        segment: NarrationSegment,
        clearWatchdog: () => void,
        arm: (ms: number) => void,
    ) {
        if (!current() || usedLocal) return;
        usedLocal = true;
        releaseLoadingHold();
        const synth = getSynth();
        if (!synth) {
            finish(current, clearWatchdog);
            return;
        }
        const u = new SpeechSynthesisUtterance(segment.text);
        u.lang = deps.voice?.lang ?? (deps.language === "en" ? "en-US" : "zh-CN");
        if (deps.voice) u.voice = deps.voice;
        u.rate = deps.rate;
        u.onend = () => finish(current, clearWatchdog);
        u.onerror = () => finish(current, clearWatchdog);
        // 一直没开始（被浏览器拦截）或开始后不触发 onend 时，超时视为读完
        u.onstart = () => arm(maxSpeakingMs(segment.text, u.rate));
        arm(START_TIMEOUT_MS);
        utterance = u;
        synth.speak(u);
    }

    function speak(index: number) {
        const segments = deps.segments;
        const segment = segments?.[index];
        if (!segment) return;
        const gen = generation;
        const token = {};
        const current = () => generation === gen && active === token;
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        const clearWatchdog = () => clearTimeout(watchdog);
        const arm = (ms: number) => {
            clearTimeout(watchdog);
            watchdog = setTimeout(() => finish(current, clearWatchdog), ms);
        };
        usedLocal = false;

        active = token;
        speaking = true;
        deps.setSpeaking(true);
        if (deps.mode !== "cloud") {
            speakLocal(current, segment, clearWatchdog, arm);
            return;
        }

        // 云端语音：提前合成下一段；本段合成较慢时先暂停画面
        const lang = deps.language;
        const next = segments?.[index + 1];
        if (next) requestSpeech(next.text, lang).catch(() => undefined);
        const loadingTimer = setTimeout(() => {
            if (!current() || waiting !== null) return;
            loadingHold = true;
            deps.setHolding(true);
            deps.hold(true);
        }, LOADING_HOLD_DELAY_MS);
        const clearLoadingTimer = () => clearTimeout(loadingTimer);
        requestSpeech(segment.text, lang).then((url) => {
            const audio = getSpeechAudio();
            if (!current()) return;
            if (!audio) {
                clearLoadingTimer();
                speakLocal(current, segment, clearWatchdog, arm);
                return;
            }
            const guard = (handler: () => void) => () => {
                if (current() && !usedLocal) handler();
            };
            audio.onplaying = guard(() => {
                clearLoadingTimer();
                releaseLoadingHold();
                arm(maxSpeakingMs(segment.text, audio.playbackRate));
            });
            audio.onended = guard(() => finish(current, clearWatchdog));
            audio.onerror = guard(() => speakLocal(current, segment, clearWatchdog, arm));
            audio.src = url;
            audio.playbackRate = deps.rate;
            arm(AUDIO_START_TIMEOUT_MS);
            audio.play().catch(guard(() => {
                clearLoadingTimer();
                speakLocal(current, segment, clearWatchdog, arm);
            }));
        }, () => {
            clearLoadingTimer();
            speakLocal(current, segment, clearWatchdog, arm);
        });
    }

    function stop(time: number) {
        generation++;
        active = null;
        utterance = null;
        speaking = false;
        deps.setSpeaking(false);
        if (waiting !== null || loadingHold) {
            waiting = null;
            loadingHold = false;
            deps.setHolding(false);
            deps.hold(false);
        }
        spoken = deps.segments ? segmentIndexAt(deps.segments, time) - 1 : -1;
        getSynth()?.cancel();
        if (deps.mode === "cloud") getSpeechAudio()?.pause();
    }

    function update(time: number) {
        const segments = deps.segments;
        if (!deps.enabled || !segments?.length || waiting !== null) return;
        if (speaking) {
            const next = spoken + 1;
            if (next >= segments.length) return;
            const gap = next > 0 ? segments[next].begin - segments[next - 1].begin : segments[next].begin;
            if (time < segments[next].begin - Math.min(HOLD_LEAD_S, gap / 2)) return;
            waiting = next;
            deps.setHolding(true);
            deps.hold(true);
            return;
        }
        const index = segmentIndexAt(segments, time);
        if (index <= spoken) return;
        spoken = index;
        speak(index);
    }

    function dispose() {
        generation++;
        getSynth()?.cancel();
        if (deps.mode === "cloud") getSpeechAudio()?.pause();
    }

    return { update, stop, dispose };
}
