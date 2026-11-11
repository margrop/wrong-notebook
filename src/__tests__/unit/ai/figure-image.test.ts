import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

import { prepareFigureImage } from '@/lib/ai/figure-image';

async function pageImage(width: number, height: number): Promise<string> {
    const buffer = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).png().toBuffer();
    return buffer.toString('base64');
}

describe('prepareFigureImage', () => {
    it('按配图位置裁剪并把长边放大到 800 像素', async () => {
        const image = await prepareFigureImage(await pageImage(1200, 702), 'image/png', { x1: 300, y1: 300, x2: 700, y2: 700 });
        expect(image).toMatchObject({ mimeType: 'image/png', cropped: true, width: 800 });
        // 裁剪区域 576×338px（各边留白 4%），按 800/576 放大
        expect(image.height).toBe(469);
        const meta = await sharp(Buffer.from(image.base64, 'base64')).metadata();
        expect([meta.width, meta.height]).toEqual([image.width, image.height]);
    });

    it('没有配图位置时用整张图，长边在 800~1600 之间保持原尺寸', async () => {
        const image = await prepareFigureImage(await pageImage(1200, 702), 'image/png', null);
        expect(image).toMatchObject({ cropped: false, width: 1200, height: 702 });
    });

    it('过大的图缩小到长边 1600 像素', async () => {
        const image = await prepareFigureImage(await pageImage(3200, 1000), 'image/png', null);
        expect(image).toMatchObject({ width: 1600, height: 500 });
    });

    it('无法解码时原样返回整张图', async () => {
        const image = await prepareFigureImage('bm90IGFuIGltYWdl', 'image/jpeg', { x1: 0, y1: 0, x2: 500, y2: 500 });
        expect(image).toEqual({ base64: 'bm90IGFuIGltYWdl', mimeType: 'image/jpeg', width: null, height: null, cropped: false });
    });
});
