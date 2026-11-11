/**
 * 识别时模型给出的配图位置（figure_box）：解析为 0~1000 归一化坐标，并换算为带留白的像素裁剪区域
 */

/** 配图位置，按图片宽高归一化到 0~1000，左上角为 (0,0) */
export interface FigureBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/** 像素裁剪区域（sharp extract 的参数） */
export interface PixelRegion {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** 配图过小（任一边不足图片的 2%）时多半是误判，退回整张图 */
const MIN_BOX_SIDE = 20;

/** 四周留白：模型框选常贴边或略小，留白避免裁掉边缘的线条和标注 */
const PADDING_RATIO = 0.04;
const MIN_PADDING_PX = 8;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * 解析 figure_box：格式为 x1,y1,x2,y2；有多个框时取能覆盖全部的外接框。
 * 全部数值不超过 1 时视为 0~1 比例并换算为 0~1000；格式不对或框过小时返回 null。
 */
export function parseFigureBox(raw: string | null | undefined): FigureBox | null {
    const numbers = raw?.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    if (!numbers || numbers.length === 0 || numbers.length % 4 !== 0) return null;
    const scale = numbers.every((value) => value <= 1) ? 1000 : 1;
    const values = numbers.map((value) => clamp(value * scale, 0, 1000));

    let box: FigureBox | null = null;
    for (let i = 0; i < values.length; i += 4) {
        const [ax, ay, bx, by] = values.slice(i, i + 4);
        const current = { x1: Math.min(ax, bx), y1: Math.min(ay, by), x2: Math.max(ax, bx), y2: Math.max(ay, by) };
        box = box
            ? { x1: Math.min(box.x1, current.x1), y1: Math.min(box.y1, current.y1), x2: Math.max(box.x2, current.x2), y2: Math.max(box.y2, current.y2) }
            : current;
    }
    if (!box || box.x2 - box.x1 < MIN_BOX_SIDE || box.y2 - box.y1 < MIN_BOX_SIDE) return null;
    return box;
}

/** 把归一化配图位置换算为图片中的像素区域，四周留白并限制在图片范围内 */
export function figureBoxToRegion(box: FigureBox, width: number, height: number): PixelRegion {
    const padX = Math.max(MIN_PADDING_PX, width * PADDING_RATIO);
    const padY = Math.max(MIN_PADDING_PX, height * PADDING_RATIO);
    const left = Math.floor(clamp(box.x1 / 1000 * width - padX, 0, width - 1));
    const top = Math.floor(clamp(box.y1 / 1000 * height - padY, 0, height - 1));
    const right = Math.ceil(clamp(box.x2 / 1000 * width + padX, left + 1, width));
    const bottom = Math.ceil(clamp(box.y2 / 1000 * height + padY, top + 1, height));
    return { left, top, width: right - left, height: bottom - top };
}
