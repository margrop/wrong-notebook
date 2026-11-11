import { describe, expect, it } from 'vitest';
import { figureBoxToRegion, parseFigureBox } from '@/lib/ai/figure-box';

describe('parseFigureBox', () => {
    it('解析 0~1000 坐标，容忍空格、括号与左右颠倒', () => {
        expect(parseFigureBox('310, 290, 670, 700')).toEqual({ x1: 310, y1: 290, x2: 670, y2: 700 });
        expect(parseFigureBox('(670,700),(310,290)')).toEqual({ x1: 310, y1: 290, x2: 670, y2: 700 });
    });

    it('0~1 比例换算为 0~1000，超出范围的值截断', () => {
        expect(parseFigureBox('0.3,0.25,0.7,0.75')).toEqual({ x1: 300, y1: 250, x2: 700, y2: 750 });
        expect(parseFigureBox('-20,100,1200,900')).toEqual({ x1: 0, y1: 100, x2: 1000, y2: 900 });
    });

    it('多个框取外接框', () => {
        expect(parseFigureBox('100,100,300,300; 500,200,800,400')).toEqual({ x1: 100, y1: 100, x2: 800, y2: 400 });
    });

    it('留空、数量不对或框过小时返回 null', () => {
        expect(parseFigureBox(null)).toBeNull();
        expect(parseFigureBox('')).toBeNull();
        expect(parseFigureBox('100,200,300')).toBeNull();
        expect(parseFigureBox('100,100,110,500')).toBeNull();
    });
});

describe('figureBoxToRegion', () => {
    it('换算为像素区域并四周留白', () => {
        const region = figureBoxToRegion({ x1: 300, y1: 250, x2: 700, y2: 750 }, 1000, 600);
        // 留白为宽高的 4%：横向 40px、纵向 24px
        expect(region).toEqual({ left: 260, top: 126, width: 480, height: 348 });
    });

    it('留白不超出图片范围', () => {
        const region = figureBoxToRegion({ x1: 0, y1: 0, x2: 1000, y2: 1000 }, 1200, 702);
        expect(region).toEqual({ left: 0, top: 0, width: 1200, height: 702 });
    });
});
