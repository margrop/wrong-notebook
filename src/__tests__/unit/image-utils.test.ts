/**
 * 上传前的图片处理：1MB 以内直接转 Base64，超过则缩放并逐步降低 JPEG 质量
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { info: vi.fn(), error: vi.fn() } }));

import { compressImage, processImageFile } from '@/lib/image-utils';

const MB = 1024 * 1024;
const fileOfSize = (bytes: number) => new File([new Uint8Array(bytes)], 'q.png', { type: 'image/png' });
/** 生成指定解码后大小（MB）的 data URL */
const dataUrlOfMB = (mb: number) => 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil((mb * MB * 4) / 3));

let imageSize = { width: 1000, height: 500 };
let toDataURL: ReturnType<typeof vi.fn>;
let drawImage: ReturnType<typeof vi.fn>;
let canvas: { width: number; height: number; getContext: () => unknown; toDataURL: typeof toDataURL };

beforeEach(() => {
    imageSize = { width: 1000, height: 500 };
    drawImage = vi.fn();
    toDataURL = vi.fn(() => dataUrlOfMB(0.5));
    canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL };
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        if (tag === 'canvas') return canvas;
        throw new Error(`unexpected element ${tag}`);
    }) as typeof document.createElement);
    // jsdom 不会真正解码图片，加载时立即回调
    vi.stubGlobal('Image', class {
        width = imageSize.width;
        height = imageSize.height;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) { setTimeout(() => this.onload?.(), 0); }
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('processImageFile', () => {
    it('1MB 以内的图片原样转成 data URL，不经过压缩', async () => {
        const result = await processImageFile(fileOfSize(1000));

        expect(result).toMatch(/^data:image\/png;base64,/);
        expect(toDataURL).not.toHaveBeenCalled();
    });

    it('超过 1MB 时压缩为 JPEG', async () => {
        const result = await processImageFile(fileOfSize(2 * MB));

        expect(result).toBe(dataUrlOfMB(0.5));
        expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8);
    });
});

describe('compressImage', () => {
    it('宽度超过上限时按比例缩小', async () => {
        imageSize = { width: 4000, height: 3000 };

        await compressImage(fileOfSize(10), 1, 1920);

        expect([canvas.width, canvas.height]).toEqual([1920, 1440]);
        expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1920, 1440);
    });

    it('不超过上限的图片保持原尺寸', async () => {
        await compressImage(fileOfSize(10));
        expect([canvas.width, canvas.height]).toEqual([1000, 500]);
    });

    it('仍然过大时逐步降低质量，满足大小后立即停止', async () => {
        toDataURL
            .mockReturnValueOnce(dataUrlOfMB(3))
            .mockReturnValueOnce(dataUrlOfMB(2))
            .mockReturnValueOnce(dataUrlOfMB(0.9));

        const result = await compressImage(fileOfSize(10), 1);

        expect(result).toBe(dataUrlOfMB(0.9));
        expect(toDataURL.mock.calls.map(([, q]) => Number(q.toFixed(1)))).toEqual([0.8, 0.7, 0.6]);
    });

    it('质量降到下限仍过大时返回最后一次结果，不会无限循环', async () => {
        toDataURL.mockReturnValue(dataUrlOfMB(5));

        await expect(compressImage(fileOfSize(10), 1)).resolves.toBe(dataUrlOfMB(5));
        expect(toDataURL.mock.calls.length).toBeLessThanOrEqual(9);
    });

    it('无法获取 Canvas 上下文时报错', async () => {
        canvas.getContext = () => null;
        await expect(compressImage(fileOfSize(10))).rejects.toThrow('无法获取 Canvas 上下文');
    });
});
