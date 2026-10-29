/**
 * 按 ITU-R BS.1770（EBU R128）测量单声道音频的综合响度（LUFS），并把语音归一化到目标响度。
 * 不同服务商、不同音色合成的音量差别较大，统一到 -15 LUFS 左右，切换段落或渠道时音量一致。
 */
import { PEAK_CEILING_DBFS, TARGET_LOUDNESS_LUFS } from "./constants";
import type { PcmAudio } from "./wav";

type Biquad = { b: [number, number, number]; a: [number, number] };

/** K 计权滤波器系数（高频搁架 + 高通），按采样率推算，与 libebur128 一致 */
function kWeightingFilters(sampleRate: number): Biquad[] {
    let f0 = 1681.974450955533;
    const gain = 3.999843853973347;
    let q = 0.7071752369554196;
    let k = Math.tan(Math.PI * f0 / sampleRate);
    const vh = Math.pow(10, gain / 20);
    const vb = Math.pow(vh, 0.4996667741545416);
    let a0 = 1 + k / q + k * k;
    const shelf: Biquad = {
        b: [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0],
        a: [2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0],
    };
    f0 = 38.13547087602444;
    q = 0.5003270373238773;
    k = Math.tan(Math.PI * f0 / sampleRate);
    a0 = 1 + k / q + k * k;
    const highPass: Biquad = {
        b: [1, -2, 1],
        a: [2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0],
    };
    return [shelf, highPass];
}

function applyBiquad(input: Float32Array, { b, a }: Biquad): Float32Array {
    const output = new Float32Array(input.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < input.length; i++) {
        const x = input[i];
        const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
        x2 = x1; x1 = x;
        y2 = y1; y1 = y;
        output[i] = y;
    }
    return output;
}

const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;

function toLufs(meanSquare: number): number {
    return -0.691 + 10 * Math.log10(meanSquare);
}

/** 综合响度（LUFS）：400ms 块、75% 重叠，先按 -70 LUFS 绝对门限、再按相对 -10 LU 门限筛选；静音返回 -Infinity */
export function measureLoudness({ sampleRate, samples }: PcmAudio): number {
    if (!samples.length) return -Infinity;
    const weighted = kWeightingFilters(sampleRate).reduce(applyBiquad, samples);
    const blockSize = Math.round(sampleRate * 0.4);
    const step = Math.round(sampleRate * 0.1);
    const blocks: number[] = [];
    // 不足一个块的短音频按整体计算
    const size = Math.min(blockSize, weighted.length);
    for (let start = 0; start + size <= weighted.length; start += step) {
        let sum = 0;
        for (let i = start; i < start + size; i++) sum += weighted[i] * weighted[i];
        blocks.push(sum / size);
    }
    const loud = blocks.filter((z) => toLufs(z) > ABSOLUTE_GATE_LUFS);
    if (!loud.length) return -Infinity;
    const relativeGate = toLufs(loud.reduce((s, z) => s + z, 0) / loud.length) + RELATIVE_GATE_LU;
    const gated = loud.filter((z) => toLufs(z) > relativeGate);
    return toLufs(gated.reduce((s, z) => s + z, 0) / gated.length);
}

/**
 * 把语音归一化到目标响度；放大后超过峰值上限的部分用软限幅压住，避免削波。
 * 静音（测不出响度）时原样返回
 */
export function normalizeLoudness(audio: PcmAudio, target = TARGET_LOUDNESS_LUFS, peakCeilingDb = PEAK_CEILING_DBFS): PcmAudio {
    const loudness = measureLoudness(audio);
    if (!Number.isFinite(loudness)) return audio;
    const gain = Math.pow(10, (target - loudness) / 20);
    const ceiling = Math.pow(10, peakCeilingDb / 20);
    // 低于拐点线性放大，高于拐点按 tanh 平滑压到上限以内
    const knee = ceiling * 0.8;
    const range = ceiling - knee;
    const samples = new Float32Array(audio.samples.length);
    for (let i = 0; i < samples.length; i++) {
        const value = audio.samples[i] * gain;
        const magnitude = Math.abs(value);
        samples[i] = magnitude <= knee ? value : Math.sign(value) * (knee + range * Math.tanh((magnitude - knee) / range));
    }
    return { sampleRate: audio.sampleRate, samples };
}
