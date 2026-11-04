/**
 * PDF 页面图形元素（图片绘制与矢量路径）检测的纯函数部分。
 *
 * 与 pdfjs getOperatorList() 的输出配合：
 * - paintImageXObject / paintInlineImageXObject / paintImageMaskXObject 等：
 *   参数为 [imageName, width, height] 或 [width, height]；外接矩形 = 当前变换矩阵
 *   作用下的 (0,0)-(w,h) 单位矩形；
 * - paintImageXObjectRepeat / paintImageMaskXObjectRepeat / paintSolidColorImageMask：
 *   绘制多个小图（repeat）或单像素掩码，本任务不追踪（视为无图形）；
 * - constructPath：参数 [flags, pathDataArray, minMax]，minMax 为路径在「当前用户空间」
 *   的外接框 [x0, y0, x1, y1]（y 自下而上，需套用当前变换矩阵并翻转 y）。
 *
 * 矩阵跟踪：遇到 save/restore 入栈/出栈，transform/concat 右乘当前矩阵。
 * 过滤规则：忽略面积 > 80% 页面 或 < 4pt² 的图形（页面边框、噪点）。
 */

/** 2D 仿射变换矩阵 [a, b, c, d, e, f]：x' = a·x + c·y + e；y' = b·x + d·y + f */
export type Matrix = [number, number, number, number, number, number];

/** 单位矩阵 */
export const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

/** 矩阵右乘：result = base ∘ next（先应用 next 再应用 base） */
export function multiplyMatrices(base: Matrix, next: Matrix): Matrix {
    const [a1, b1, c1, d1, e1, f1] = base;
    const [a2, b2, c2, d2, e2, f2] = next;
    return [
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    ];
}

/** 把矩阵作用于点 */
export function applyMatrix(matrix: Matrix, x: number, y: number): { x: number; y: number } {
    const [a, b, c, d, e, f] = matrix;
    return { x: a * x + c * y + e, y: b * x + d * y + f };
}

/** 矩形（PDF 用户空间，y 自下而上） */
export interface GraphicsRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * 计算单位矩形 (0,0)-(w,h) 经矩阵变换后的外接矩形（轴对齐）。
 * 注意矩阵可能含旋转/错切，外接矩形取四顶点包围盒。
 */
export function transformedBoundingBox(matrix: Matrix, width: number, height: number): GraphicsRect {
    const p1 = applyMatrix(matrix, 0, 0);
    const p2 = applyMatrix(matrix, width, 0);
    const p3 = applyMatrix(matrix, 0, height);
    const p4 = applyMatrix(matrix, width, height);
    const xs = [p1.x, p2.x, p3.x, p4.x];
    const ys = [p1.y, p2.y, p3.y, p4.y];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 把 pdfjs constructPath 的 minMax（当前用户空间，y 自下而上）转为页面矩形。
 * 先以当前矩阵变换四角，再取包围盒（与图片一致，处理旋转）。
 */
export function minMaxToBoundingBox(matrix: Matrix, minMax: [number, number, number, number]): GraphicsRect {
    const [x0, y0, x1, y1] = minMax;
    return transformedBoundingBoxFromCorners(matrix, x0, y0, x1, y1);
}

function transformedBoundingBoxFromCorners(matrix: Matrix, x0: number, y0: number, x1: number, y1: number): GraphicsRect {
    const p1 = applyMatrix(matrix, x0, y0);
    const p2 = applyMatrix(matrix, x1, y0);
    const p3 = applyMatrix(matrix, x0, y1);
    const p4 = applyMatrix(matrix, x1, y1);
    const xs = [p1.x, p2.x, p3.x, p4.x];
    const ys = [p1.y, p2.y, p3.y, p4.y];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 检测出的图形元素 */
export interface PdfGraphicElement {
    kind: "image" | "vector";
    /** 页面矩形（y 自下而上，与 PdfPageRegion 转换前一致） */
    rect: GraphicsRect;
}

/** 过滤阈值：面积超过页面 80% 或小于 4pt² 的图形忽略 */
const MAX_AREA_RATIO = 0.8;
const MIN_AREA_PT2 = 4;

/** 判断单个图形是否值得保留（非整页边框/背景、非噪点） */
export function isSignificantGraphic(rect: GraphicsRect, pageWidth: number, pageHeight: number): boolean {
    const area = rect.width * rect.height;
    if (area < MIN_AREA_PT2) return false;
    const pageArea = pageWidth * pageHeight;
    if (pageArea > 0 && area > pageArea * MAX_AREA_RATIO) return false;
    return true;
}

/** pdfjs OPS 编号（与 pdfjs 6.x 的 OPS 常量一致；解析时动态对齐，避免版本硬编码） */
export interface GraphicsOpsCodes {
    save: number;
    restore: number;
    transform: number;
    paintImageMaskXObject: number;
    paintImageMaskXObjectGroup: number;
    paintImageXObject: number;
    paintInlineImageXObject: number;
    paintInlineImageXObjectGroup: number;
    paintImageXObjectRepeat: number;
    paintImageMaskXObjectRepeat: number;
    paintSolidColorImageMask: number;
    constructPath: number;
}

/** pdfjs getOperatorList() 返回的最小类型 */
export interface OperatorListLike {
    fnArray: number[];
    argsArray: unknown[];
}

/**
 * 从单页 operator list 提取图形元素（图片绘制 + 矢量路径）。
 *
 * 返回的矩形为页面坐标（y 自下而上，与 PDF 用户空间一致）。
 * paintImageXObjectRepeat 等平铺绘制与单像素掩码不追踪（视为装饰性/背景）。
 */
export function extractGraphicsFromOperatorList(
    opList: OperatorListLike,
    pageWidth: number,
    pageHeight: number,
    ops: GraphicsOpsCodes,
): PdfGraphicElement[] {
    const elements: PdfGraphicElement[] = [];
    let matrix: Matrix = [...IDENTITY_MATRIX];
    const stack: Matrix[] = [];

    for (let index = 0; index < opList.fnArray.length; index++) {
        const fn = opList.fnArray[index];
        const args = opList.argsArray[index];

        if (fn === ops.save) {
            stack.push([...matrix]);
            continue;
        }
        if (fn === ops.restore) {
            const restored = stack.pop();
            if (restored) matrix = restored;
            continue;
        }
        if (fn === ops.transform) {
            const t = args as ArrayLike<number> | null;
            if (t && typeof t.length === "number" && t.length >= 6) {
                matrix = multiplyMatrices(matrix, [Number(t[0]), Number(t[1]), Number(t[2]), Number(t[3]), Number(t[4]), Number(t[5])]);
            }
            continue;
        }

        if (
            fn === ops.paintImageXObject ||
            fn === ops.paintInlineImageXObject ||
            fn === ops.paintImageMaskXObject ||
            fn === ops.paintImageMaskXObjectGroup ||
            fn === ops.paintInlineImageXObjectGroup
        ) {
            // 参数形状：[imageName, width, height]（XObject）或 [width, height]（Inline/MaskGroup）
            const list = args as ArrayLike<unknown> | null;
            if (!list || typeof list.length !== "number" || list.length < 2) continue;
            const width = Number(list[list.length - 2]);
            const height = Number(list[list.length - 1]);
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) continue;
            const rect = transformedBoundingBox(matrix, width, height);
            if (isSignificantGraphic(rect, pageWidth, pageHeight)) {
                elements.push({ kind: "image", rect });
            }
            continue;
        }

        if (fn === ops.constructPath) {
            const list = args as ArrayLike<unknown> | null;
            if (!list || typeof list.length !== "number" || list.length < 3) continue;
            const minMaxRaw = list[2] as ArrayLike<number> | null;
            if (!minMaxRaw || typeof minMaxRaw.length !== "number" || minMaxRaw.length < 4) continue;
            const nums = [0, 1, 2, 3].map((index) => Number(minMaxRaw[index]));
            if (nums.some((value) => !Number.isFinite(value))) continue;
            const rect = minMaxToBoundingBox(matrix, [nums[0], nums[1], nums[2], nums[3]]);
            if (isSignificantGraphic(rect, pageWidth, pageHeight)) {
                elements.push({ kind: "vector", rect });
            }
            continue;
        }
    }

    return elements;
}

/**
 * 把页面矩形（y 自下而上）转为自上而下坐标。
 * 与 regions.ts 的 PdfPageRegion.rect 对齐，便于求交。
 */
export function flipRectToTopDown(rect: GraphicsRect, pageHeight: number): { x: number; yTop: number; width: number; height: number } {
    const top = pageHeight - (rect.y + rect.height);
    return { x: rect.x, yTop: top, width: rect.width, height: rect.height };
}

/** 两矩形是否相交（自上而下坐标） */
export function rectIntersects(
    a: { x: number; yTop: number; width: number; height: number },
    b: { x: number; yTop: number; width: number; height: number },
): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.yTop < b.yTop + b.height && b.yTop < a.yTop + a.height;
}

/** 判断题目区域段是否与任一图形元素相交（自上而下坐标） */
export function regionHasGraphics(
    region: { page: number; rect: { x: number; yTop: number; width: number; height: number } },
    pageGraphics: Map<number, PdfGraphicElement[]>,
    pageHeight: (page: number) => number,
): boolean {
    const graphics = pageGraphics.get(region.page) ?? [];
    const height = pageHeight(region.page);
    for (const element of graphics) {
        const flipped = flipRectToTopDown(element.rect, height);
        if (rectIntersects(region.rect, flipped)) return true;
    }
    return false;
}
