/**
 * 云端语音前端模块：查询朗读方式、合成请求去重与失败重试、点击中解锁播放
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: api }));

import { getSpeechAudio, getSpeechMode, isSpeechAudioUnlocked, regenerateSpeech, requestSpeech, resetCloudSpeechForTest, unlockSpeechAudio } from '@/lib/cloud-speech';

beforeEach(() => {
    vi.clearAllMocks();
    resetCloudSpeechForTest();
});

describe('云端语音前端', () => {
    it('整页只查询一次朗读方式，查询失败时用浏览器语音', async () => {
        api.get.mockResolvedValue({ mode: 'cloud' });
        expect(await getSpeechMode()).toBe('cloud');
        expect(await getSpeechMode()).toBe('cloud');
        expect(api.get).toHaveBeenCalledTimes(1);

        resetCloudSpeechForTest();
        api.get.mockRejectedValue(new Error('401'));
        expect(await getSpeechMode()).toBe('browser');
    });

    it('同样的文字只请求一次合成；失败后下次重新请求', async () => {
        api.post.mockResolvedValue({ id: 'abc', version: 1 });
        expect(await requestSpeech('第一步', 'zh')).toBe('/api/tts/abc?v=1');
        expect(await requestSpeech('第一步', 'zh')).toBe('/api/tts/abc?v=1');
        expect(api.post).toHaveBeenCalledTimes(1);
        expect(api.post).toHaveBeenCalledWith('/api/tts', { text: '第一步', language: 'zh' }, expect.objectContaining({ recoverable: true }));

        api.post.mockRejectedValueOnce(new Error('502'));
        await expect(requestSpeech('第二步', 'zh')).rejects.toThrow('502');
        api.post.mockResolvedValue({ id: 'def', version: 2 });
        expect(await requestSpeech('第二步', 'zh')).toBe('/api/tts/def?v=2');
    });

    it('重新生成逐段请求服务端忽略缓存，之后播放使用新版本的地址；失败时停止', async () => {
        api.post.mockResolvedValue({ id: 'abc', version: 1 });
        await requestSpeech('第一步', 'zh');

        api.post.mockResolvedValue({ id: 'abc', version: 9 });
        const progress = vi.fn();
        await regenerateSpeech(['第一步', '第二步'], 'zh', progress);
        expect(api.post).toHaveBeenCalledWith('/api/tts', { text: '第一步', language: 'zh', regenerate: true }, expect.anything());
        expect(progress.mock.calls).toEqual([[1], [2]]);
        expect(await requestSpeech('第一步', 'zh')).toBe('/api/tts/abc?v=9');
        expect(api.post).toHaveBeenCalledTimes(3);

        api.post.mockRejectedValueOnce(new Error('502'));
        await expect(regenerateSpeech(['第三步', '第四步'], 'zh', progress)).rejects.toThrow('502');
        expect(api.post).toHaveBeenCalledTimes(4);
    });

    it('在点击中播放一段静音解锁，被拒绝时下次再试', async () => {
        const audio = getSpeechAudio()!;
        const play = vi.spyOn(audio, 'play').mockRejectedValueOnce(new Error('NotAllowedError'));
        unlockSpeechAudio();
        expect(audio.src).toMatch(/^data:audio\/wav;base64,/);
        await Promise.resolve();
        await Promise.resolve();
        expect(isSpeechAudioUnlocked()).toBe(false);

        play.mockResolvedValue(undefined);
        unlockSpeechAudio();
        expect(isSpeechAudioUnlocked()).toBe(true);
        unlockSpeechAudio();
        expect(play).toHaveBeenCalledTimes(2);
    });
});
