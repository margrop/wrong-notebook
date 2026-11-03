import { describe, expect, it } from 'vitest';
import { stackLayout } from '@/lib/batch-crop';

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
});
