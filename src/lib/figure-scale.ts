/** 配图比例按题目保存，100% 保持原有显示尺寸。 */
export const DEFAULT_FIGURE_SCALE = 100;
export const MIN_FIGURE_SCALE = 10;
export const MAX_FIGURE_SCALE = 200;

export const FIGURE_ALIGNS = ['left', 'center', 'right'] as const;
export type FigureAlign = typeof FIGURE_ALIGNS[number];
export const DEFAULT_FIGURE_ALIGN: FigureAlign = 'center';

export function isValidFigureScale(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value)
        && value >= MIN_FIGURE_SCALE && value <= MAX_FIGURE_SCALE;
}

/** 兼容旧数据和缺少比例字段的备份。 */
export function normalizeFigureScale(value: unknown): number {
    return isValidFigureScale(value) ? value : DEFAULT_FIGURE_SCALE;
}

export function isValidFigureAlign(value: unknown): value is FigureAlign {
    return typeof value === 'string' && (FIGURE_ALIGNS as readonly string[]).includes(value);
}

/** 兼容旧数据和缺少位置字段的备份。 */
export function normalizeFigureAlign(value: unknown): FigureAlign {
    return isValidFigureAlign(value) ? value : DEFAULT_FIGURE_ALIGN;
}
