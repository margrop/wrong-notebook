/**
 * svg-narration 浏览器语音工具：语音选择与 iOS 解锁
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findVoice, getSynth, isSpeechUnlocked, resetSpeechUnlockForTest, unlockSpeech } from '@/lib/svg-narration/browser-speech';

function voice(lang: string, localService = true): SpeechSynthesisVoice {
    return { lang, localService } as SpeechSynthesisVoice;
}

describe('findVoice', () => {
    it('中文优先选 zh-CN 本地语音', () => {
        const voices = [voice('zh-TW'), voice('zh-CN'), voice('en-US')];
        expect(findVoice(voices, 'zh')?.lang).toBe('zh-CN');
    });

    it('中文匹配 cmn 前缀（安卓系统语音）', () => {
        const voices = [voice('cmn-Hans-CN'), voice('en-US')];
        expect(findVoice(voices, 'zh')?.lang).toBe('cmn-Hans-CN');
    });

    it('优先选本地语音，其次选匹配的远程语音', () => {
        const remote = voice('zh-CN', false);
        expect(findVoice([remote], 'zh')?.lang).toBe('zh-CN');
        const both = [voice('zh-CN', false), voice('zh-CN', true)];
        expect(findVoice(both, 'zh')?.localService).toBe(true);
    });

    it('英文优先选 en-US', () => {
        const voices = [voice('en-GB'), voice('en-US'), voice('zh-CN')];
        expect(findVoice(voices, 'en')?.lang).toBe('en-US');
    });

    it('没有匹配语言时返回 undefined', () => {
        expect(findVoice([voice('ja-JP')], 'zh')).toBeUndefined();
        expect(findVoice([], 'en')).toBeUndefined();
    });
});

describe('getSynth', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        delete (window as { speechSynthesis?: unknown }).speechSynthesis;
    });

    it('有 speechSynthesis 时返回它', () => {
        const synth = { speak: vi.fn() };
        Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
        vi.stubGlobal('SpeechSynthesisUtterance', class {});
        expect(getSynth()).toBe(synth);
    });

    it('没有 speechSynthesis 时返回 null', () => {
        expect(getSynth()).toBeNull();
    });
});

describe('unlockSpeech', () => {
    class FakeUtterance {
        volume = 1;
        constructor(public text: string) {}
    }

    let spoken: FakeUtterance[];

    const synth = {
        speak: vi.fn((u: FakeUtterance) => { spoken.push(u); }),
        cancel: vi.fn(),
    };

    beforeEach(() => {
        spoken = [];
        resetSpeechUnlockForTest();
        Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
        vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete (window as { speechSynthesis?: unknown }).speechSynthesis;
    });

    it('在用户点击中读一段无声内容解锁，整页只解锁一次', () => {
        expect(isSpeechUnlocked()).toBe(false);
        unlockSpeech();
        expect(spoken).toHaveLength(1);
        expect(spoken[0]).toMatchObject({ text: ' ', volume: 0 });
        expect(isSpeechUnlocked()).toBe(true);

        unlockSpeech();
        expect(spoken).toHaveLength(1);
    });

    it('重置后可再次解锁', () => {
        unlockSpeech();
        resetSpeechUnlockForTest();
        expect(isSpeechUnlocked()).toBe(false);
        unlockSpeech();
        expect(spoken).toHaveLength(2);
    });

    it('不支持语音合成时不解锁', () => {
        delete (window as { speechSynthesis?: unknown }).speechSynthesis;
        unlockSpeech();
        expect(spoken).toHaveLength(0);
        expect(isSpeechUnlocked()).toBe(false);
    });
});
