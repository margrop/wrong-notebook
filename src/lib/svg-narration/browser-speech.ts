/**
 * 浏览器语音合成（Web Speech API）的封装：语音选择与 iOS 解锁。
 * iOS Safari 只允许在用户点击的处理中首次调用 speak，之后定时触发的朗读才会出声；
 * 在点击中先读一段无声的内容来解锁（整个页面只需一次）。
 */

/** 语音合成的语言代码前缀（安卓系统的中文语音可能为 cmn） */
const VOICE_LANG_PREFIXES: Record<"zh" | "en", string[]> = { zh: ["zh", "cmn"], en: ["en"] };

export function getSynth(): SpeechSynthesis | null {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined"
        ? window.speechSynthesis
        : null;
}

export function findVoice(voices: SpeechSynthesisVoice[], language: "zh" | "en"): SpeechSynthesisVoice | undefined {
    const prefixes = VOICE_LANG_PREFIXES[language];
    const matches = voices.filter((voice) => prefixes.some((prefix) => voice.lang.toLowerCase().startsWith(prefix)));
    const preferred = language === "zh" ? /^(zh|cmn)[-_](cn|hans)/i : /^en[-_]us/i;
    return matches.find((voice) => preferred.test(voice.lang) && voice.localService)
        ?? matches.find((voice) => preferred.test(voice.lang))
        ?? matches[0];
}

/** 本页面是否已在用户点击中发过声（iOS Safari 解锁语音合成，整个页面只需一次） */
let speechUnlocked = false;

/** 在用户点击（开启语音、播放、重播）中调用，解锁 iOS 上的朗读 */
export function unlockSpeech() {
    const synth = getSynth();
    if (!synth || speechUnlocked) return;
    speechUnlocked = true;
    const utterance = new SpeechSynthesisUtterance(" ");
    utterance.volume = 0;
    synth.speak(utterance);
}

/** 仅供测试：重置解锁状态 */
export function resetSpeechUnlockForTest() {
    speechUnlocked = false;
}

/** 本页面是否已解锁语音合成（供主 hook 判断是否需要监听下一次点击） */
export function isSpeechUnlocked() {
    return speechUnlocked;
}
