/**
 * SVG 动画语音讲解：按时间朗读、等待朗读时暂停画面、停止与开关
 */
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeAudio {
    src = '';
    playbackRate = 1;
    onplaying: (() => void) | null = null;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn(() => Promise.resolve());
    pause = vi.fn();
}

const cloud = vi.hoisted(() => ({
    mode: 'browser' as 'browser' | 'cloud',
    audio: null as unknown,
    requestSpeech: vi.fn(),
    unlock: vi.fn(),
}));

vi.mock('@/lib/cloud-speech', () => ({
    getSpeechMode: () => Promise.resolve(cloud.mode),
    getSpeechAudio: () => cloud.audio,
    isSpeechAudioUnlocked: () => false,
    requestSpeech: cloud.requestSpeech,
    unlockSpeechAudio: cloud.unlock,
}));

import { resetSpeechUnlockForTest, segmentIndexAt, useSvgNarration } from '@/lib/use-svg-narration';
import type { NarrationSegment } from '@/lib/svg-animation';

type Narration = ReturnType<typeof useSvgNarration>;

class FakeUtterance {
    lang = '';
    rate = 1;
    volume = 1;
    onstart: (() => void) | null = null;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
}

const segments: NarrationSegment[] = [
    { begin: 0, text: '第一步' },
    { begin: 5, text: '第二步' },
];

let root: Root;
let host: HTMLDivElement;
let narration: Narration;
let spoken: FakeUtterance[];
let voices: { lang: string; localService: boolean }[];
const hold = vi.fn();
const synth = {
    speak: vi.fn((u: FakeUtterance) => spoken.push(u)),
    cancel: vi.fn(),
    getVoices: vi.fn(() => voices),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
};

function Probe({ language = 'zh' }: { language?: 'zh' | 'en' }) {
    const value = useSvgNarration({ segments, language, holdAnimation: hold });
    useEffect(() => { narration = value; });
    return null;
}

async function render(language: 'zh' | 'en' = 'zh') {
    await act(async () => { root.render(<Probe language={language} />); });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    spoken = [];
    cloud.mode = 'browser';
    cloud.audio = null;
    resetSpeechUnlockForTest();
    voices = [{ lang: 'zh-CN', localService: true }, { lang: 'en-US', localService: true }];
    localStorage.setItem('svg-narration-enabled', '1');
    host = document.createElement('div');
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    localStorage.clear();
    vi.unstubAllGlobals();
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
});

describe('segmentIndexAt', () => {
    it('返回时间所在的段', () => {
        expect(segmentIndexAt(segments, 0)).toBe(0);
        expect(segmentIndexAt(segments, 4.9)).toBe(0);
        expect(segmentIndexAt(segments, 5)).toBe(1);
        expect(segmentIndexAt([{ begin: 1, text: 'a' }], 0)).toBe(-1);
    });
});

describe('useSvgNarration', () => {
    it('进入新的段时朗读，同一段只读一次', async () => {
        await render();
        expect(narration.supported).toBe(true);
        expect(narration.enabled).toBe(true);

        act(() => narration.update(0));
        act(() => narration.update(1));
        expect(spoken.map((u) => u.text)).toEqual(['第一步']);
        expect(spoken[0].lang).toBe('zh-CN');

        act(() => spoken[0].onend?.());
        act(() => narration.update(5));
        expect(spoken.map((u) => u.text)).toEqual(['第一步', '第二步']);
        expect(hold).not.toHaveBeenCalled();
    });

    it('上一段没读完时暂停画面，读完后恢复并朗读下一段', async () => {
        await render();
        act(() => narration.update(0));
        act(() => narration.update(5.1));
        expect(hold).toHaveBeenLastCalledWith(true);
        expect(spoken).toHaveLength(1);

        act(() => spoken[0].onend?.());
        expect(hold).toHaveBeenLastCalledWith(false);
        act(() => narration.update(5.1));
        expect(spoken.map((u) => u.text)).toEqual(['第一步', '第二步']);
    });

    it('在下一段开始前、换步过渡之前暂停等待，并对外提示正在等待', async () => {
        await render();
        act(() => narration.update(0));
        expect(narration.speaking).toBe(true);

        act(() => narration.update(3));
        expect(hold).not.toHaveBeenCalled();

        act(() => narration.update(4.3));
        expect(hold).toHaveBeenLastCalledWith(true);
        expect(narration.holding).toBe(true);

        act(() => spoken[0].onend?.());
        expect(hold).toHaveBeenLastCalledWith(false);
        expect(narration.holding).toBe(false);
        expect(narration.speaking).toBe(false);

        // 恢复后到下一段开始才朗读
        act(() => narration.update(4.5));
        expect(spoken).toHaveLength(1);
        act(() => narration.update(5));
        expect(spoken.map((u) => u.text)).toEqual(['第一步', '第二步']);
    });

    it('停止时取消朗读并恢复等待中的画面，继续播放从当前段重新朗读', async () => {
        await render();
        act(() => narration.update(0));
        act(() => narration.update(5));
        act(() => narration.stop(6));
        expect(synth.cancel).toHaveBeenCalled();
        expect(hold).toHaveBeenLastCalledWith(false);

        // 已取消的朗读结束回调不再生效
        act(() => spoken[0].onend?.());
        act(() => narration.update(6));
        expect(spoken.map((u) => u.text)).toEqual(['第一步', '第二步']);
    });

    it('默认关闭；开启后记住设置，语速循环切换', async () => {
        localStorage.clear();
        await render();
        expect(narration.enabled).toBe(false);
        act(() => narration.update(0));
        expect(spoken).toHaveLength(0);

        act(() => narration.setEnabled(true, 0));
        expect(localStorage.getItem('svg-narration-enabled')).toBe('1');
        act(() => narration.cycleRate());
        expect(narration.rate).toBe(1.25);
        act(() => narration.update(0));
        expect(spoken.at(-1)?.rate).toBe(1.25);
    });

    it('没有该语言的语音或浏览器不支持时不可用', async () => {
        voices = [{ lang: 'zh-CN', localService: true }];
        await render('en');
        expect(narration.supported).toBe(false);

        delete (window as { speechSynthesis?: unknown }).speechSynthesis;
        await render('zh');
        expect(narration.supported).toBe(false);
    });

    it('开启语音的点击中先读一段无声内容，解锁 iOS 上的朗读，整页只解锁一次', async () => {
        localStorage.clear();
        await render();
        act(() => narration.setEnabled(true, 0));
        expect(spoken).toHaveLength(1);
        expect(spoken[0]).toMatchObject({ text: ' ', volume: 0 });

        act(() => narration.prime());
        expect(spoken).toHaveLength(1);
    });

    it('已开启但未解锁时，页面上的下一次点击会解锁', async () => {
        await render();
        expect(spoken).toHaveLength(0);
        act(() => { document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(spoken[0]).toMatchObject({ text: ' ', volume: 0 });
    });

    it('朗读被浏览器拦截（一直没开始）时超时视为读完，画面不会一直等待', async () => {
        vi.useFakeTimers();
        try {
            await render();
            act(() => narration.update(0));
            act(() => narration.update(5));
            expect(hold).toHaveBeenLastCalledWith(true);

            act(() => { vi.advanceTimersByTime(2500); });
            expect(hold).toHaveBeenLastCalledWith(false);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('useSvgNarration 云端语音', () => {
    let audio: FakeAudio;
    const flush = () => act(async () => { await Promise.resolve(); });

    beforeEach(() => {
        cloud.mode = 'cloud';
        audio = new FakeAudio();
        cloud.audio = audio;
        cloud.requestSpeech.mockImplementation((text: string) => Promise.resolve(`/api/tts/${text}`));
    });

    it('播放服务端合成的语音并提前合成后面的段；读完前暂停画面，播完恢复', async () => {
        await render();
        expect(narration.supported).toBe(true);
        // 开启语音时提前合成前两段
        expect(cloud.requestSpeech).toHaveBeenCalledWith('第一步', 'zh');
        expect(cloud.requestSpeech).toHaveBeenCalledWith('第二步', 'zh');

        act(() => narration.update(0));
        await flush();
        expect(audio.src).toBe('/api/tts/第一步');
        expect(audio.play).toHaveBeenCalled();
        act(() => audio.onplaying?.());

        act(() => narration.update(5));
        expect(hold).toHaveBeenLastCalledWith(true);
        act(() => audio.onended?.());
        expect(hold).toHaveBeenLastCalledWith(false);

        act(() => narration.update(5));
        await flush();
        expect(audio.src).toBe('/api/tts/第二步');
        expect(spoken).toHaveLength(0);
    });

    it('语速作用于正在播放的语音；停止时暂停播放', async () => {
        await render();
        act(() => narration.update(0));
        await flush();
        act(() => narration.cycleRate());
        expect(audio.playbackRate).toBe(1.25);

        act(() => narration.stop(0));
        expect(audio.pause).toHaveBeenCalled();
        // 已停止的语音播完不再影响画面
        hold.mockClear();
        act(() => audio.onended?.());
        expect(hold).not.toHaveBeenCalled();
    });

    it('合成失败或播放出错时改用浏览器语音', async () => {
        cloud.requestSpeech.mockImplementation(() => Promise.reject(new Error('502')));
        await render();
        act(() => narration.update(0));
        await flush();
        expect(spoken.map((u) => u.text)).toEqual(['第一步']);

        cloud.requestSpeech.mockImplementation((text: string) => Promise.resolve(`/api/tts/${text}`));
        act(() => spoken[0].onend?.());
        act(() => narration.update(5));
        await flush();
        act(() => audio.onerror?.());
        act(() => audio.onerror?.());
        expect(spoken.map((u) => u.text)).toEqual(['第一步', '第二步']);
    });

    it('合成较慢时暂停画面等待，开始播放后恢复', async () => {
        vi.useFakeTimers();
        try {
            let resolve!: (url: string) => void;
            cloud.requestSpeech.mockImplementation(() => new Promise((r) => { resolve = r; }));
            await render();
            act(() => narration.update(0));
            act(() => { vi.advanceTimersByTime(300); });
            expect(hold).toHaveBeenLastCalledWith(true);
            expect(narration.holding).toBe(true);

            resolve('/api/tts/slow');
            await flush();
            act(() => audio.onplaying?.());
            expect(hold).toHaveBeenLastCalledWith(false);
            expect(narration.holding).toBe(false);
            expect(narration.speaking).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('点击播放时同时解锁音频播放', async () => {
        await render();
        act(() => narration.prime());
        expect(cloud.unlock).toHaveBeenCalled();
    });
});
