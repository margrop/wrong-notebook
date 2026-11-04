/**
 * 根据分题行范围计算每道题的版面区域（PDF 页面坐标，纯函数）。
 *
 * - 同页同栏：区域为「题号行顶部 → 下一题首行顶部」；
 * - 跨栏/跨页：拆成多段，前段延伸到该栏/页的内容底部（页眉页脚区外），
 *   后续段从该栏/页的内容顶部开始，直到本题首行（或下一题首行）；
 * - 最后一题：末段延伸到该栏/页的内容底部；
 * - 左右边界取所在栏的整宽，附带上下留白（REGION_PADDING）。
 *
 * 输入 PdfLine 与分题输出的 lineRange 一一对应（parse.ts 中 linesToText 按行 join）。
 * 坐标系：PdfLine.yTop 为自上而下（与渲染/截图一致），PdfPageRegion 也用自上而下，
 * 便于与渲染像素直接映射。
 */

import type { PdfLine } from "@/lib/import/file-parsers/pdf/layout";

/** 一个矩形区域（PDF 页面坐标，yTop 自上而下，单位 pt） */
export interface PdfRect {
    x: number;
    yTop: number;
    width: number;
    height: number;
}

/** 一段题目版面区域：所在页 + 页内矩形（yTop 自上而下） */
export interface PdfPageRegion {
    page: number;
    rect: PdfRect;
}

/** 每题的区域段数组；null 表示无法定位（lineRange 缺失或越界） */
export type PdfQuestionRegions = Array<PdfPageRegion[] | null>;

/** 页眉页脚排除带：每页顶部/底部高度（pt，自上而下坐标） */
export interface PdfHeaderFooterZone {
    /** 页眉区底部（yTop < top 的部分排除） */
    top: number;
    /** 页脚区顶部（yTop > bottom 的部分排除） */
    bottom: number;
}

/** 区域留白（上下各 4pt） */
const REGION_PADDING = 4;

/** 双栏页面的中缝比例（与 layout.ts 的 DOUBLE_COLUMN_GAP_RATIO 对齐） */
const DOUBLE_COLUMN_GAP_RATIO = 0.06;

interface PageSize {
    width: number;
    height: number;
}

/** 每页栏切分点（x 坐标列表）；单栏页为空数组 */
interface ColumnSplit {
    boundaries: number[];
}

/** 用行首 x 估计行右端（用于栏归属判定，不需精确宽度） */
function lineRightEstimate(line: PdfLine): number {
    return line.x + Math.max(line.height * 0.5, 1);
}

/** 行归属的栏序号（0 起）；未检测到双栏时恒为 0 */
function columnIndexOf(line: PdfLine, split: ColumnSplit | null): number {
    if (!split || split.boundaries.length === 0) return 0;
    const center = line.x + (lineRightEstimate(line) - line.x) / 2;
    for (let index = 0; index < split.boundaries.length; index++) {
        if (center < split.boundaries[index]) return index;
    }
    return split.boundaries.length;
}

/**
 * 检测每页是否为双栏（复用 layout.ts 规则：左右两半各有文字且中缝空白）。
 * 返回每页的栏切分点；单栏页不放入结果。
 */
export function detectColumnSplits(lines: PdfLine[], pages: PageSize[]): Map<number, ColumnSplit> {
    const byPage = new Map<number, PdfLine[]>();
    for (const line of lines) {
        const list = byPage.get(line.page) ?? [];
        list.push(line);
        byPage.set(line.page, list);
    }
    const result = new Map<number, ColumnSplit>();
    for (const [page, pageLines] of byPage) {
        const info = pages.find((entry, index) => index + 1 === page);
        if (!info || info.width <= 0) continue;
        const center = info.width / 2;
        const gapHalf = info.width * DOUBLE_COLUMN_GAP_RATIO;
        const leftText = pageLines
            .filter((line) => lineRightEstimate(line) <= center + gapHalf)
            .reduce((sum, line) => sum + line.text.trim().length, 0);
        const rightText = pageLines
            .filter((line) => line.x >= center - gapHalf)
            .reduce((sum, line) => sum + line.text.trim().length, 0);
        const total = leftText + rightText;
        if (total < 1) continue;
        const gutter = pageLines.some((line) => line.x < center + gapHalf && lineRightEstimate(line) > center - gapHalf);
        if (!gutter && leftText >= total * 0.25 && rightText >= total * 0.25) {
            result.set(page, { boundaries: [center] });
        }
    }
    return result;
}

/** 页眉页脚区域：每页顶部/底部高度（与 layout.ts 比例一致） */
export function headerFooterZones(pages: PageSize[]): Map<number, PdfHeaderFooterZone> {
    const result = new Map<number, PdfHeaderFooterZone>();
    pages.forEach((info, index) => {
        if (info.height <= 0) return;
        result.set(index + 1, {
            top: info.height * 0.15,
            bottom: info.height * 0.92,
        });
    });
    return result;
}

interface ColumnGeometry {
    left: number;
    right: number;
}

function columnGeometry(split: ColumnSplit | null, column: number, pageWidth: number): ColumnGeometry {
    if (!split || split.boundaries.length === 0) return { left: 0, right: pageWidth };
    const left = column > 0 ? split.boundaries[column - 1] : 0;
    const right = column < split.boundaries.length ? split.boundaries[column] : pageWidth;
    return { left, right };
}

/**
 * 计算一道题的区域段。
 *
 * @param fromLine  题号行在 lines 中的下标（含）
 * @param toLine    下一题首行行下标（不含）；最后一题为 lines.length
 * @param nextLine  下一题首行行下标；最后一题为 lines.length
 * @param lines     重建行（已排除页眉页脚行）
 * @param pages     每页尺寸
 * @param splits    双栏切分（detectColumnSplits 的结果）
 * @param zones     页眉页脚区域
 * @param graphics  每页图形外接框（自上而下坐标），用于收紧没有下一题作边界的段底
 */
export function computeQuestionRegions(
    fromLine: number,
    toLine: number,
    lines: PdfLine[],
    pages: PageSize[],
    splits: Map<number, ColumnSplit>,
    zones: Map<number, PdfHeaderFooterZone>,
    graphics: Map<number, PdfRect[]> = new Map(),
): PdfPageRegion[] {
    if (fromLine < 0 || fromLine >= lines.length) return [];
    const stop = Math.min(toLine, lines.length);
    const nextIndex = Math.min(stop, lines.length);
    const nextLine = nextIndex < lines.length ? lines[nextIndex] : null;
    const firstLine = lines[fromLine];

    /** 下一题首行是否在指定页与栏 */
    const nextIsAt = (page: number, column: number, split: ColumnSplit | null): boolean => {
        if (!nextLine || nextLine.page !== page) return false;
        return columnIndexOf(nextLine, split) === column;
    };

    const segments: PdfPageRegion[] = [];
    const startPage = firstLine.page;
    const endLine = lines[stop - 1] ?? firstLine;
    const endPage = endLine.page;

    for (let page = startPage; page <= endPage; page++) {
        const info = pages.find((entry, index) => index + 1 === page);
        if (!info) continue;
        const zone = zones.get(page) ?? { top: 0, bottom: info.height };
        const split = splits.get(page) ?? null;

        const pageLines: PdfLine[] = [];
        for (let index = fromLine; index < stop; index++) {
            const line = lines[index];
            if (line.page === page) pageLines.push(line);
        }
        if (pageLines.length === 0) continue;

        const columns = new Map<number, PdfLine[]>();
        for (const line of pageLines) {
            const column = columnIndexOf(line, split);
            const list = columns.get(column) ?? [];
            list.push(line);
            columns.set(column, list);
        }

        const sortedColumns = Array.from(columns.entries()).sort((a, b) => a[0] - b[0]);
        for (const [column, columnLines] of sortedColumns) {
            const first = columnLines[0];
            const geometry = columnGeometry(split, column, info.width);

            // 段顶：本题在该栏的首行文字顶部（页眉页脚行在重建文字行时已剔除，不再按固定比例裁剪）。
            // 题目延续到新的栏/页时，首行之上、页眉区以下属于本栏的图形（如延续的配图）一并包含。
            const isFirstSegment = page === startPage && column === columnIndexOf(firstLine, splits.get(startPage) ?? null);
            let regionTop = Math.max(0, first.yTop - REGION_PADDING);
            if (!isFirstSegment) {
                for (const box of graphics.get(page) ?? []) {
                    const inColumn = box.x < geometry.right && box.x + box.width > geometry.left;
                    if (inColumn && box.yTop >= zone.top && box.yTop + box.height <= first.yTop) {
                        regionTop = Math.min(regionTop, Math.max(0, box.yTop - REGION_PADDING));
                    }
                }
            }

            // 段底：同栏下一题首行顶部；否则延伸到底部
            let regionBottom: number;
            if (nextIsAt(page, column, split)) {
                regionBottom = nextLine!.yTop - REGION_PADDING;
            } else {
                // 没有下一题作边界（最后一题、或题目延续到下一栏/页）：收紧到本段最后一行文字与段内图形的底部，
                // 避免截进大片空白
                const last = columnLines[columnLines.length - 1];
                let contentBottom = last.yTop + last.height;
                for (const box of graphics.get(page) ?? []) {
                    const inColumn = box.x < geometry.right && box.x + box.width > geometry.left;
                    if (inColumn && box.yTop >= regionTop && box.yTop < zone.bottom) {
                        contentBottom = Math.max(contentBottom, box.yTop + box.height);
                    }
                }
                regionBottom = contentBottom + REGION_PADDING;
            }
            regionBottom = Math.min(regionBottom, info.height);

            if (regionBottom <= regionTop) continue;

            segments.push({
                page,
                rect: {
                    x: geometry.left,
                    yTop: regionTop,
                    width: geometry.right - geometry.left,
                    height: regionBottom - regionTop,
                },
            });
        }
    }

    return mergeSegments(segments);
}

/** 合并同页重叠或相接的段（保持输入顺序稳定） */
function mergeSegments(segments: PdfPageRegion[]): PdfPageRegion[] {
    if (segments.length <= 1) return segments;
    const result: PdfPageRegion[] = [];
    for (const segment of segments) {
        const prev = result[result.length - 1];
        if (prev && prev.page === segment.page && rectanglesOverlap(prev.rect, segment.rect)) {
            prev.rect = unionRect(prev.rect, segment.rect);
        } else {
            result.push({ ...segment, rect: { ...segment.rect } });
        }
    }
    return result;
}

function rectanglesOverlap(a: PdfRect, b: PdfRect): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.yTop < b.yTop + b.height && b.yTop < a.yTop + a.height;
}

function unionRect(a: PdfRect, b: PdfRect): PdfRect {
    const x = Math.min(a.x, b.x);
    const yTop = Math.min(a.yTop, b.yTop);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = Math.max(a.yTop + a.height, b.yTop + b.height);
    return { x, yTop, width: right - x, height: bottom - yTop };
}

/**
 * 从题号行向上合并紧挨着的「缩进行」：同页同栏、与下面一行几乎没有间隙、且明显比题号行靠右开始。
 * 典型情况是多行公式（方程组、分式）的首行高于题号行，文字重建时排在题号行之前。
 */
export function extendStartUpward(fromLine: number, lines: PdfLine[], splits: Map<number, ColumnSplit>): number {
    const first = lines[fromLine];
    if (!first) return fromLine;
    const split = splits.get(first.page) ?? null;
    const column = columnIndexOf(first, split);
    let start = fromLine;
    while (start > 0) {
        const above = lines[start - 1];
        const below = lines[start];
        if (above.page !== first.page || columnIndexOf(above, split) !== column) break;
        const gap = below.yTop - (above.yTop + above.height);
        const indented = above.x > first.x + first.height * 2;
        if (gap > first.height * 0.8 || !indented) break;
        start -= 1;
    }
    return start;
}

/**
 * 为全部题目计算区域段（与 questions 下标对应；lineRange 缺失/越界时为 null）。
 */
export function computeAllQuestionRegions(
    lineRanges: Array<{ from: number; to: number } | undefined>,
    lines: PdfLine[],
    pages: PageSize[],
    graphics: Map<number, PdfRect[]> = new Map(),
): PdfQuestionRegions {
    const splits = detectColumnSplits(lines, pages);
    const zones = headerFooterZones(pages);
    // 题号行上方紧挨着的公式行（如方程组的首行）归入本题：调整各题起始行，上一题的区域也随之止于这些行之上
    const starts = lineRanges.map((range) => (range ? extendStartUpward(range.from, lines, splits) : undefined));
    return lineRanges.map((range, index) => {
        if (!range || range.from < 0 || range.from >= lines.length) return null;
        const from = starts[index] ?? range.from;
        const nextStart = starts.slice(index + 1).find((start) => start !== undefined);
        const to = nextStart !== undefined && nextStart < range.to ? nextStart : range.to;
        return computeQuestionRegions(from, to, lines, pages, splits, zones, graphics);
    });
}
