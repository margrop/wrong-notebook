/**
 * 云端语音的音频处理：WAV 编解码、BS.1770 响度测量与归一化
 */
import { describe, expect, it } from 'vitest';
import { measureLoudness, normalizeLoudness } from '@/lib/tts/loudness';
import { encodeMp3, looksLikeMp3 } from '@/lib/tts/mp3';
import { encodeWav, parseWav, pcm16ToFloat } from '@/lib/tts/wav';
import type { PcmAudio } from '@/lib/tts/wav';

function sine(sampleRate: number, seconds: number, amplitude: number, frequency = 1000): PcmAudio {
    const samples = new Float32Array(Math.round(sampleRate * seconds));
    for (let i = 0; i < samples.length; i++) samples[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate);
    return { sampleRate, samples };
}

/** 类似语音的信号：多个频率叠加，按音节起伏，中间夹着停顿 */
function speechLike(sampleRate: number, amplitude: number): PcmAudio {
    const samples = new Float32Array(sampleRate * 4);
    for (let i = 0; i < samples.length; i++) {
        const t = i / sampleRate;
        const envelope = Math.max(0, Math.sin(2 * Math.PI * 3 * t)) * (t % 1 < 0.8 ? 1 : 0);
        const tone = Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 900 * t) + 0.25 * Math.sin(2 * Math.PI * 2600 * t);
        samples[i] = amplitude * envelope * tone / 1.75;
    }
    return { sampleRate, samples };
}

const peak = (audio: PcmAudio) => audio.samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

describe('响度测量', () => {
    it('满幅 1 kHz 正弦波约为 -3.01 LUFS，与采样率无关', () => {
        expect(measureLoudness(sine(48000, 2, 1))).toBeCloseTo(-3.01, 1);
        expect(measureLoudness(sine(24000, 2, 1))).toBeCloseTo(-3.01, 1);
    });

    it('幅度减半约低 6 dB；静音为 -Infinity', () => {
        expect(measureLoudness(sine(24000, 2, 0.5))).toBeCloseTo(-9.03, 1);
        expect(measureLoudness({ sampleRate: 24000, samples: new Float32Array(24000) })).toBe(-Infinity);
        expect(measureLoudness({ sampleRate: 24000, samples: new Float32Array(0) })).toBe(-Infinity);
    });

    it('不足 400ms 的短音频按整体计算', () => {
        expect(measureLoudness(sine(24000, 0.2, 1))).toBeCloseTo(-3.01, 0);
    });
});

describe('响度归一化', () => {
    it('偏小和偏大的语音都调整到 -16 ~ -14 LUFS，峰值不超过上限', () => {
        for (const amplitude of [0.05, 0.3, 0.95]) {
            const result = normalizeLoudness(speechLike(24000, amplitude));
            const loudness = measureLoudness(result);
            expect(loudness).toBeGreaterThanOrEqual(-16);
            expect(loudness).toBeLessThanOrEqual(-14);
            expect(peak(result)).toBeLessThanOrEqual(Math.pow(10, -1.5 / 20) + 1e-6);
        }
    });

    it('需要大幅放大时用软限幅压住峰值', () => {
        const result = normalizeLoudness(sine(24000, 1, 0.01), -3);
        expect(peak(result)).toBeLessThanOrEqual(Math.pow(10, -1.5 / 20) + 1e-6);
    });

    it('静音原样返回', () => {
        const silent = { sampleRate: 24000, samples: new Float32Array(100) };
        expect(normalizeLoudness(silent)).toBe(silent);
    });
});

describe('WAV 编解码', () => {
    it('编码后能解析回相同的采样', () => {
        const audio = sine(24000, 0.1, 0.5);
        const parsed = parseWav(encodeWav(audio));
        expect(parsed.sampleRate).toBe(24000);
        expect(parsed.samples.length).toBe(audio.samples.length);
        parsed.samples.forEach((value, i) => expect(value).toBeCloseTo(audio.samples[i], 3));
    });

    it('双声道混为单声道，数据长度写成 0 时读到文件末尾', () => {
        const wav = encodeWav({ sampleRate: 8000, samples: new Float32Array([0.5, 0.25, -0.5, 0]) });
        wav.writeUInt16LE(2, 22);
        wav.writeUInt32LE(0, 40);
        const parsed = parseWav(wav);
        expect(parsed.samples.length).toBe(2);
        expect(parsed.samples[0]).toBeCloseTo(0.375, 3);
        expect(parsed.samples[1]).toBeCloseTo(-0.25, 3);
    });

    it('拒绝非 WAV 或非 16 位的数据', () => {
        expect(() => parseWav(Buffer.from('not a wav file'))).toThrow('INVALID_WAV');
        const wav = encodeWav({ sampleRate: 8000, samples: new Float32Array(4) });
        wav.writeUInt16LE(8, 34);
        expect(() => parseWav(wav)).toThrow('UNSUPPORTED_WAV');
    });

    it('16 位小端 PCM 转浮点', () => {
        const pcm = Buffer.alloc(4);
        pcm.writeInt16LE(16384, 0);
        pcm.writeInt16LE(-32768, 2);
        expect(Array.from(pcm16ToFloat(pcm))).toEqual([0.5, -1]);
    });
});

describe('MP3 编码', () => {
    it('编码为 48kbps 单声道 MP3，体积远小于 WAV', () => {
        const audio = speechLike(24000, 0.3);
        const mp3 = encodeMp3(audio);
        expect(looksLikeMp3(mp3)).toBe(true);
        // 4 秒 48kbps 约 24KB，WAV 约 192KB
        expect(mp3.length).toBeGreaterThan(15000);
        expect(mp3.length).toBeLessThan(35000);
        expect(encodeWav(audio).length / mp3.length).toBeGreaterThan(5);
    });

    it('识别 ID3 标签和帧同步字，拒绝其他数据', () => {
        expect(looksLikeMp3(Buffer.from('ID3\u0004'))).toBe(true);
        expect(looksLikeMp3(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe(true);
        expect(looksLikeMp3(Buffer.from('RIFF'))).toBe(false);
        expect(looksLikeMp3(Buffer.from([0xff]))).toBe(false);
    });
});
