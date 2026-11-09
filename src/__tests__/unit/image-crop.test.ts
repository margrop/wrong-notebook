import { describe, it, expect, vi } from 'vitest';
import { applyEraseStrokes, drawRotatedCrop, rotatedCropGeometry, toSafeImageSrc } from '@/lib/image-crop';
import type { EraseStroke } from '@/lib/image-crop';

describe('toSafeImageSrc', () => {
    it('接受本地文件生成的 blob 与 data 图片地址', () => {
        expect(toSafeImageSrc('blob:http://localhost:3000/0f1e2d3c')).toBe('blob:http://localhost:3000/0f1e2d3c');
        expect(toSafeImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    });

    it('拒绝脚本、HTML 和普通网络地址', () => {
        expect(toSafeImageSrc('javascript:alert(1)')).toBeUndefined();
        expect(toSafeImageSrc('data:text/html,<script>alert(1)</script>')).toBeUndefined();
        expect(toSafeImageSrc('https://example.com/a.png')).toBeUndefined();
        expect(toSafeImageSrc('')).toBeUndefined();
    });
});

describe('applyEraseStrokes', () => {
    // 测试用最小画布上下文；只需要擦除笔画用到的绘制方法
    const fakeContext = () => ({
        save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
        stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
        fillStyle: '', strokeStyle: '', lineCap: '', lineJoin: '', lineWidth: 0,
    }) as unknown as CanvasRenderingContext2D;

    it('把相对整张图片的笔画映射到裁剪后的输出画布', () => {
        const context = fakeContext();
        const strokes: EraseStroke[] = [{
            points: [{ x: 0.2, y: 0.4 }, { x: 0.3, y: 0.4 }],
            radius: 0.01,
        }];
        applyEraseStrokes(context, strokes, { width: 1000, height: 500 },
            { sx: 100, sy: 100, sw: 400, sh: 100 }, { width: 200, height: 50 });
        // x: (0.2×1000−100)×0.5 = 50；y: (0.4×500−100)×0.5 = 50；半径 0.01×1000×0.5 = 5，线宽 10
        expect(context.moveTo).toHaveBeenCalledWith(50, 50);
        expect(context.lineTo).toHaveBeenCalledWith(100, 50);
        expect(context.lineWidth).toBe(10);
        expect(context.strokeStyle).toBe('#ffffff');
    });

    it('单点笔画画成圆点，没有笔画时不触碰画布', () => {
        const context = fakeContext();
        applyEraseStrokes(context, [{ points: [{ x: 0.5, y: 0.5 }], radius: 0.005 }],
            { width: 1000, height: 1000 }, { sx: 0, sy: 0, sw: 1000, sh: 1000 }, { width: 1000, height: 1000 });
        expect(context.arc).toHaveBeenCalledWith(500, 500, 5, 0, Math.PI * 2);
        expect(context.fill).toHaveBeenCalled();

        const untouched = fakeContext();
        applyEraseStrokes(untouched, [], { width: 1000, height: 1000 },
            { sx: 0, sy: 0, sw: 1000, sh: 1000 }, { width: 1000, height: 1000 });
        expect(untouched.save).not.toHaveBeenCalled();
    });
});

describe('旋转裁剪', () => {
    it('90 度旋转把横向画面转为纵向，并正确映射原图区域', () => {
        // 原图 1000×500；区域在旋转后的 500×1000 画面中为 (125,500,250,250)
        expect(rotatedCropGeometry(1000, 500, { x: 0.25, y: 0.5, width: 0.5, height: 0.25, rotation: 90 })).toMatchObject({
            frameWidth: 500, frameHeight: 1000,
            fx: 125, fy: 500, fw: 250, fh: 250,
            sx: 500, sy: 125, sw: 250, sh: 250,
            outputWidth: 250, outputHeight: 250,
        });
    });

    it('270 度旋转从反方向映射原图区域', () => {
        expect(rotatedCropGeometry(1000, 500, { x: 0.25, y: 0.5, width: 0.5, height: 0.25, rotation: 270 })).toMatchObject({
            frameWidth: 500, frameHeight: 1000,
            sx: 250, sy: 125, sw: 250, sh: 250,
        });
    });

    it('旋转后按顺时针方向绘制，并擦除相对旋转画面的笔迹', () => {
        const drawImage = vi.fn();
        const context = {
            fillRect: vi.fn(), drawImage, translate: vi.fn(), rotate: vi.fn(),
            save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
            stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
            fillStyle: '', strokeStyle: '', lineCap: '', lineJoin: '', lineWidth: 0,
            imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
        } as unknown as CanvasRenderingContext2D;
        const geometry = rotatedCropGeometry(1000, 500, { x: 0.25, y: 0.5, width: 0.5, height: 0.25, rotation: 90 });
        drawRotatedCrop(context, {} as CanvasImageSource, geometry, 250, 250, [{
            points: [{ x: 0.25, y: 0.5 }], radius: 0.01,
        }]);
        expect(context.translate).toHaveBeenCalledWith(250, 0);
        expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
        expect(drawImage).toHaveBeenCalledWith(expect.anything(), 500, 125, 250, 250, 0, 0, 250, 250);
        // 笔迹落在旋转画面左上角：x=0, y=0
        expect(context.arc).toHaveBeenCalledWith(0, 0, 5, 0, Math.PI * 2);
    });
});
