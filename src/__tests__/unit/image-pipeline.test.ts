/**
 * 图片处理流程的纯函数：按文件头识别真实格式（使用 macOS 生成的真实 HEIC 文件）、输出尺寸限制
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeOutputSize, DEFAULT_IMAGE_LIMITS, sniffImageFormat } from '@/lib/image-pipeline';

const fixture = (name: string) => new Uint8Array(readFileSync(resolve('src/__tests__/fixtures/images', name)));
const brandFile = (major: string, ...compatible: string[]) => {
    const brands = [major, '\0\0\0\0', ...compatible].join('');
    const size = 8 + brands.length;
    return new Uint8Array([0, 0, 0, size, ...Array.from('ftyp' + brands, (char) => char.charCodeAt(0))]);
};

describe('sniffImageFormat', () => {
    it('按文件头识别真实 HEIC，不依赖扩展名', () => {
        expect(sniffImageFormat(fixture('math_test.heic'))).toBe('heic');
        expect(sniffImageFormat(fixture('orientation-6.heic'))).toBe('heic');
        // 扩展名为 .jpg 的 HEIC 仍识别为 HEIC
        expect(sniffImageFormat(fixture('heic-named-as.jpg'))).toBe('heic');
    });

    it('识别常见格式', () => {
        // 该测试图片扩展名为 .png，实际内容是 JPEG：按内容识别
        expect(sniffImageFormat(fixture('math_test.png'))).toBe('jpeg');
        expect(sniffImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
        expect(sniffImageFormat(fixture('orientation-6.jpg'))).toBe('jpeg');
        expect(sniffImageFormat(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
        expect(sniffImageFormat(new TextEncoder().encode('GIF89a......'))).toBe('gif');
        expect(sniffImageFormat(new TextEncoder().encode('not an image'))).toBe('unknown');
    });

    it('区分 HEIF 与 AVIF 品牌', () => {
        expect(sniffImageFormat(brandFile('mif1', 'heic'))).toBe('heic');
        expect(sniffImageFormat(brandFile('heix', 'mif1'))).toBe('heic');
        expect(sniffImageFormat(brandFile('avif', 'mif1', 'miaf'))).toBe('avif');
        expect(sniffImageFormat(brandFile('mif1', 'avif'))).toBe('avif');
        expect(sniffImageFormat(brandFile('isom', 'mp41'))).toBe('unknown');
    });
});

describe('computeOutputSize', () => {
    it('整页手机照片按总像素缩小：竖拍与原先按 1920 宽缩放相同，横拍保留更多细节', () => {
        const landscape = computeOutputSize(4032, 3024);
        expect(landscape.width * landscape.height).toBeLessThanOrEqual(DEFAULT_IMAGE_LIMITS.maxPixels);
        expect(landscape).toMatchObject({ width: 2560, height: 1920 });
        expect(computeOutputSize(3024, 4032)).toMatchObject({ width: 1920, height: 2560 });
    });

    it('细长图即使文件很小也受像素与最长边限制', () => {
        const size = computeOutputSize(800, 8000);
        expect(size.height).toBeLessThanOrEqual(DEFAULT_IMAGE_LIMITS.maxLongEdge);
        expect(size.width * size.height).toBeLessThanOrEqual(DEFAULT_IMAGE_LIMITS.maxPixels);
        expect(size).toMatchObject({ width: 409, height: 4096 });
    });

    it('题目裁剪区域在限制内时按原分辨率输出，不放大', () => {
        expect(computeOutputSize(1800, 900)).toMatchObject({ width: 1800, height: 900, scale: 1 });
        expect(computeOutputSize(120, 80)).toMatchObject({ width: 120, height: 80 });
    });

    it('2400×3600 的整页试卷缩到约 490 万像素', () => {
        const size = computeOutputSize(2400, 3600);
        expect(size.width * size.height).toBeLessThanOrEqual(DEFAULT_IMAGE_LIMITS.maxPixels);
        expect(size.height).toBeGreaterThan(2400);
    });
});

// ---------- 解码与编码（jsdom 中模拟画布与系统解码） ----------
import { afterEach, beforeEach, vi } from 'vitest';
import { ImageDecodeError, prepareImage, renderRegion } from '@/lib/image-pipeline';

const heic = vi.hoisted(() => ({ heicTo: vi.fn() }));
vi.mock('heic-to/csp', () => heic);

interface FakeCanvas { width: number; height: number; quality: number[]; drawImage: ReturnType<typeof vi.fn> }
let canvases: FakeCanvas[];
/** 编码后的字节数：按像素与质量估算 */
let bytesFor: (width: number, height: number, quality: number) => number;

beforeEach(() => {
    canvases = [];
    bytesFor = () => 1000;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        if (tag !== 'canvas') return createElement(tag);
        const canvas: FakeCanvas & Record<string, unknown> = {
            width: 0, height: 0, quality: [], drawImage: vi.fn(),
            getContext: () => ({ fillRect: vi.fn(), drawImage: canvas.drawImage, fillStyle: '', imageSmoothingEnabled: false, imageSmoothingQuality: 'low' }),
            toBlob: (callback: (blob: Blob) => void, _type: string, quality: number) => {
                canvas.quality.push(quality);
                callback(new Blob([new Uint8Array(Math.round(bytesFor(canvas.width, canvas.height, quality)))], { type: 'image/jpeg' }));
            },
        };
        canvases.push(canvas);
        return canvas as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }));
    heic.heicTo.mockReset();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/** jsdom 不解码图片：模拟 <img> 加载失败（与浏览器无法解码 HEIC 时一致） */
class FailingImage {
    onerror: (() => void) | null = null;
    set src(_value: string) { setTimeout(() => this.onerror?.(), 0); }
}

const source = (width: number, height: number) => ({ source: { width, height, close: vi.fn() } as unknown as ImageBitmap, width, height });

describe('renderRegion', () => {
    it('裁剪坐标映射到原图，一次缩放到输出尺寸', async () => {
        const original = source(4000, 3000);
        const result = await renderRegion(original, { x: 0.25, y: 0.5, width: 0.5, height: 0.25 });
        expect(canvases).toHaveLength(1);
        expect(canvases[0].drawImage).toHaveBeenCalledWith(original.source, 1000, 1500, 2000, 750, 0, 0, 2000, 750);
        expect(result).toMatchObject({ width: 2000, height: 750, quality: 0.9, bytes: 1000 });
        expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('800×8000 的细长图即使体积很小也按像素与最长边缩小', async () => {
        const result = await renderRegion(source(800, 8000));
        expect(result).toMatchObject({ width: 409, height: 4096 });
        expect(canvases[0].quality).toEqual([0.9]);
    });

    it('体积超出时先把质量降到下限 0.8，再缩小尺寸，不会为满足体积继续降低质量', async () => {
        // 每像素约 0.5 字节 × 质量：2560×1920 在 0.8 质量时约 1.97MB，超过 1.5MB
        bytesFor = (width, height, quality) => width * height * 0.5 * quality;
        const result = await renderRegion(source(4032, 3024));
        const qualities = canvases.flatMap((canvas) => canvas.quality);
        expect(qualities.slice(0, 3)).toEqual([0.9, 0.85, 0.8]);
        expect(Math.min(...qualities)).toBe(0.8);
        expect(canvases.length).toBeGreaterThan(1);
        expect(result.bytes).toBeLessThanOrEqual(1.5 * 1024 * 1024);
        expect(result.width / result.height).toBeCloseTo(4032 / 3024, 1);
    });
});

describe('prepareImage', () => {
    const file = (name: string, type = '') => new File([readFileSync(resolve('src/__tests__/fixtures/images', name))], name, { type });

    it('系统可以解码时不加载 HEIC 解码库（如 Safari 解码 HEIC）', async () => {
        const createImageBitmap = vi.fn(async () => ({ width: 1024, height: 1024, close: vi.fn() }));
        vi.stubGlobal('createImageBitmap', createImageBitmap);
        const prepared = await prepareImage(file('math_test.heic', 'image/heic'));
        expect(prepared).toMatchObject({ format: 'heic', decoder: 'native', width: 1024, height: 1024, previewUrl: 'blob:preview' });
        expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: 'from-image' });
        expect(heic.heicTo).not.toHaveBeenCalled();
    });

    it('系统无法解码真实 HEIC 时按需加载解码库转为 JPEG，并通知转换阶段', async () => {
        const createImageBitmap = vi.fn()
            .mockRejectedValueOnce(new Error('unsupported'))
            .mockResolvedValue({ width: 300, height: 600, close: vi.fn() });
        vi.stubGlobal('createImageBitmap', createImageBitmap);
        vi.stubGlobal('Image', FailingImage);
        heic.heicTo.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
        const onConverting = vi.fn();
        // 扩展名和 MIME 都声称是 JPEG，按文件头识别为 HEIC
        const prepared = await prepareImage(file('heic-named-as.jpg', 'image/jpeg'), onConverting);
        expect(prepared).toMatchObject({ format: 'heic', decoder: 'heic', width: 300, height: 600, sourceType: 'image/jpeg' });
        expect(heic.heicTo).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/jpeg' }));
        expect(onConverting).toHaveBeenCalledTimes(1);
    });

    it('HEIC 解码库也失败时给出 HEIC 专用错误码', async () => {
        vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
        vi.stubGlobal('Image', FailingImage);
        heic.heicTo.mockRejectedValue(new Error('corrupt'));
        await expect(prepareImage(file('corrupt.heic'))).rejects.toMatchObject({ code: 'HEIC_DECODE_FAILED', format: 'heic' });
    });

    it('区分无法解码的图片与不是图片的文件', async () => {
        vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')));
        vi.stubGlobal('Image', FailingImage);
        const broken = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], 'broken.jpg', { type: 'image/jpeg' });
        await expect(prepareImage(broken)).rejects.toMatchObject({ code: 'IMAGE_DECODE_FAILED', format: 'jpeg' });
        const text = new File(['hello'], 'note.txt', { type: 'text/plain' });
        const error = await prepareImage(text).catch((reason: unknown) => reason);
        expect(error).toBeInstanceOf(ImageDecodeError);
        expect(error).toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
        expect(heic.heicTo).not.toHaveBeenCalled();
    });
});
