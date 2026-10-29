/**
 * 16 位 PCM 与 WAV 的转换：云端语音合成返回的 PCM / WAV 解码为浮点采样（再归一化响度并编码为 MP3）
 */

export interface PcmAudio {
    sampleRate: number;
    /** 单声道浮点采样，范围 [-1, 1] */
    samples: Float32Array;
}

/** 16 位小端 PCM（单声道）转浮点采样 */
export function pcm16ToFloat(buffer: Buffer): Float32Array {
    const count = Math.floor(buffer.length / 2);
    const samples = new Float32Array(count);
    for (let i = 0; i < count; i++) samples[i] = buffer.readInt16LE(i * 2) / 32768;
    return samples;
}

/** 解析 16 位 PCM 的 WAV 文件，多声道时取平均混为单声道 */
export function parseWav(buffer: Buffer): PcmAudio {
    if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('INVALID_WAV');
    }
    let offset = 12;
    let channels = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    while (offset + 8 <= buffer.length) {
        const id = buffer.toString('ascii', offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        const body = offset + 8;
        if (id === 'fmt ') {
            const format = buffer.readUInt16LE(body);
            channels = buffer.readUInt16LE(body + 2);
            sampleRate = buffer.readUInt32LE(body + 4);
            bitsPerSample = buffer.readUInt16LE(body + 14);
            // 1 为 PCM，0xFFFE 为扩展格式（同样是整数 PCM）
            if ((format !== 1 && format !== 0xfffe) || bitsPerSample !== 16 || channels < 1) throw new Error('UNSUPPORTED_WAV');
        } else if (id === 'data') {
            if (!sampleRate) throw new Error('INVALID_WAV');
            // 流式生成的 WAV 可能把长度写成 0 或 0xFFFFFFFF，按实际剩余字节读取
            const end = size > 0 && body + size <= buffer.length ? body + size : buffer.length;
            const interleaved = pcm16ToFloat(buffer.subarray(body, end));
            if (channels === 1) return { sampleRate, samples: interleaved };
            const frames = Math.floor(interleaved.length / channels);
            const samples = new Float32Array(frames);
            for (let i = 0; i < frames; i++) {
                let sum = 0;
                for (let c = 0; c < channels; c++) sum += interleaved[i * channels + c];
                samples[i] = sum / channels;
            }
            return { sampleRate, samples };
        }
        offset = body + size + (size % 2);
    }
    throw new Error('INVALID_WAV');
}

/** 浮点采样编码为 16 位单声道 WAV */
export function encodeWav({ sampleRate, samples }: PcmAudio): Buffer {
    const dataSize = samples.length * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0, 'ascii');
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8, 'ascii');
    buffer.write('fmt ', 12, 'ascii');
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36, 'ascii');
    buffer.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        buffer.writeInt16LE(Math.round(value < 0 ? value * 32768 : value * 32767), 44 + i * 2);
    }
    return buffer;
}
