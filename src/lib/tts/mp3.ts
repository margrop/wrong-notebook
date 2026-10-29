/**
 * 把归一化后的语音编码为 MP3（单声道 48kbps），体积约为 WAV 的八分之一，便于缓存和随数据备份导出
 */
import { Mp3Encoder } from "@breezystack/lamejs";
import type { PcmAudio } from "./wav";

const BITRATE_KBPS = 48;
const FRAME_SAMPLES = 1152;

export function encodeMp3({ sampleRate, samples }: PcmAudio): Buffer {
    const encoder = new Mp3Encoder(1, sampleRate, BITRATE_KBPS);
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        pcm[i] = Math.round(value < 0 ? value * 32768 : value * 32767);
    }
    const chunks: Uint8Array[] = [];
    for (let start = 0; start < pcm.length; start += FRAME_SAMPLES) {
        const chunk = encoder.encodeBuffer(pcm.subarray(start, start + FRAME_SAMPLES));
        if (chunk.length) chunks.push(chunk);
    }
    const tail = encoder.flush();
    if (tail.length) chunks.push(tail);
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

/** 粗略判断是否为 MP3 数据：以 ID3 标签或 MPEG 帧同步字开头 */
export function looksLikeMp3(data: Buffer): boolean {
    if (data.length < 4) return false;
    if (data.toString('latin1', 0, 3) === 'ID3') return true;
    return data[0] === 0xff && (data[1] & 0xe0) === 0xe0;
}
