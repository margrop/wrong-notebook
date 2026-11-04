import { describe, expect, it } from 'vitest';
import { stackLayout } from '@/lib/import/batch-crop';

describe('纵向拼接版面', () => {
    it('同一张图上的多个区域保持原尺寸左对齐', () => {
        expect(stackLayout([{ width: 400, height: 100 }, { width: 200, height: 50 }], 16)).toEqual({
            width: 400, height: 166,
            rects: [{ x: 0, y: 0, width: 400, height: 100 }, { x: 0, y: 116, width: 200, height: 50 }],
        });
    });
    it('不同照片的段缩放到同一宽度', () => {
        expect(stackLayout([{ width: 600, height: 400 }, { width: 300, height: 200 }, { width: 1200, height: 300 }], 16, true)).toEqual({
            width: 1200, height: 800 + 16 + 800 + 16 + 300,
            rects: [
                { x: 0, y: 0, width: 1200, height: 800 },
                { x: 0, y: 816, width: 1200, height: 800 },
                { x: 0, y: 1632, width: 1200, height: 300 },
            ],
        });
    });
    it('续页：上一页的区域按两页宽度之比缩放，放在下一页上方', () => {
        // 上一页宽 4000，区域 2000×500；下一页宽 3000，比例 0.75
        expect(stackLayout([{ width: 2000, height: 500, scale: 0.75 }, { width: 3000, height: 4000 }], 16)).toEqual({
            width: 3000, height: 375 + 16 + 4000,
            rects: [{ x: 0, y: 0, width: 1500, height: 375 }, { x: 0, y: 391, width: 3000, height: 4000 }],
        });
    });
});
