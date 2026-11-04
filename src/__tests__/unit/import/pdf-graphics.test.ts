/**
 * graphics.ts 纯函数测试：矩阵变换、外接框、图形过滤、operator list 解析、区域求交。
 */
import { describe, expect, it } from "vitest";
import {
    applyMatrix,
    extractGraphicsFromOperatorList,
    flipRectToTopDown,
    IDENTITY_MATRIX,
    isSignificantGraphic,
    minMaxToBoundingBox,
    multiplyMatrices,
    rectIntersects,
    regionHasGraphics,
    transformedBoundingBox,
} from "@/lib/import/file-parsers/pdf/graphics";
import type { GraphicsOpsCodes, OperatorListLike } from "@/lib/import/file-parsers/pdf/graphics";

const PAGE_W = 612;
const PAGE_H = 792;

/** 与 pdfjs 6.x 一致的 OPS 编号（测试用硬编码，生产代码动态解析） */
const OPS: GraphicsOpsCodes = {
    save: 10,
    restore: 11,
    transform: 12,
    paintImageMaskXObject: 83,
    paintImageMaskXObjectGroup: 84,
    paintImageXObject: 85,
    paintInlineImageXObject: 86,
    paintInlineImageXObjectGroup: 87,
    paintImageXObjectRepeat: 88,
    paintImageMaskXObjectRepeat: 89,
    paintSolidColorImageMask: 90,
    constructPath: 91,
};

describe("multiplyMatrices", () => {
    it("单位矩阵 × 任意矩阵 = 任意矩阵", () => {
        const m: [number, number, number, number, number, number] = [2, 0, 0, 3, 10, 20];
        expect(multiplyMatrices(IDENTITY_MATRIX, m)).toEqual(m);
        expect(multiplyMatrices(m, IDENTITY_MATRIX)).toEqual(m);
    });

    it("平移矩阵组合：先平移 (10,20) 再平移 (5,5) = (15,25)", () => {
        const t1: [number, number, number, number, number, number] = [1, 0, 0, 1, 10, 20];
        const t2: [number, number, number, number, number, number] = [1, 0, 0, 1, 5, 5];
        const result = multiplyMatrices(t1, t2);
        expect(result).toEqual([1, 0, 0, 1, 15, 25]);
    });

    it("缩放 + 平移组合", () => {
        const scale: [number, number, number, number, number, number] = [2, 0, 0, 2, 0, 0];
        const translate: [number, number, number, number, number, number] = [1, 0, 0, 1, 100, 50];
        const result = multiplyMatrices(translate, scale);
        // 先缩放 (x*2, y*2) 再平移 (+100, +50)
        expect(applyMatrix(result, 10, 10)).toEqual({ x: 120, y: 70 });
    });
});

describe("transformedBoundingBox", () => {
    it("单位矩阵下返回原矩形", () => {
        const rect = transformedBoundingBox(IDENTITY_MATRIX, 100, 50);
        expect(rect).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    });

    it("平移矩阵偏移位置", () => {
        const m: [number, number, number, number, number, number] = [1, 0, 0, 1, 200, 100];
        const rect = transformedBoundingBox(m, 50, 30);
        expect(rect).toEqual({ x: 200, y: 100, width: 50, height: 30 });
    });

    it("缩放矩阵改变尺寸", () => {
        const m: [number, number, number, number, number, number] = [2, 0, 0, 3, 0, 0];
        const rect = transformedBoundingBox(m, 10, 10);
        expect(rect).toEqual({ x: 0, y: 0, width: 20, height: 30 });
    });
});

describe("minMaxToBoundingBox", () => {
    it("constructPath 的 minMax 经平移矩阵变换", () => {
        const m: [number, number, number, number, number, number] = [1, 0, 0, 1, 100, 500];
        const rect = minMaxToBoundingBox(m, [0, 0, 50, 30]);
        expect(rect).toEqual({ x: 100, y: 500, width: 50, height: 30 });
    });
});

describe("isSignificantGraphic", () => {
    it("面积小于 4pt² 的忽略", () => {
        expect(isSignificantGraphic({ x: 0, y: 0, width: 1, height: 1 }, PAGE_W, PAGE_H)).toBe(false);
        expect(isSignificantGraphic({ x: 0, y: 0, width: 2, height: 2 }, PAGE_W, PAGE_H)).toBe(true);
    });

    it("面积超过页面 80% 的忽略（整页边框）", () => {
        expect(isSignificantGraphic({ x: 0, y: 0, width: PAGE_W, height: PAGE_H }, PAGE_W, PAGE_H)).toBe(false);
        expect(isSignificantGraphic({ x: 0, y: 0, width: PAGE_W * 0.5, height: PAGE_H }, PAGE_W, PAGE_H)).toBe(true);
    });
});

describe("extractGraphicsFromOperatorList", () => {
    it("解析 constructPath（minMax）得到矢量图形", () => {
        const opList: OperatorListLike = {
            fnArray: [OPS.constructPath],
            argsArray: [[20, [], [100, 600, 200, 650]]],
        };
        const elements = extractGraphicsFromOperatorList(opList, PAGE_W, PAGE_H, OPS);
        expect(elements).toHaveLength(1);
        expect(elements[0].kind).toBe("vector");
        expect(elements[0].rect).toEqual({ x: 100, y: 600, width: 100, height: 50 });
    });

    it("解析 paintImageXObject 得到图片外接框", () => {
        const opList: OperatorListLike = {
            fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
            argsArray: [null, [2, 0, 0, 2, 100, 500], ["img1", 50, 30], null],
        };
        const elements = extractGraphicsFromOperatorList(opList, PAGE_W, PAGE_H, OPS);
        expect(elements).toHaveLength(1);
        expect(elements[0].kind).toBe("image");
        expect(elements[0].rect).toEqual({ x: 100, y: 500, width: 100, height: 60 });
    });

    it("save/restore 正确恢复矩阵", () => {
        const opList: OperatorListLike = {
            fnArray: [
                OPS.save,
                OPS.transform,          // 平移 (100, 500)
                OPS.paintImageXObject,  // 图片 50×30 → 外接框 (100,500)-(150,530)
                OPS.restore,
                OPS.paintImageXObject,  // 回到单位矩阵 → 外接框 (0,0)-(50,30)
            ],
            argsArray: [null, [1, 0, 0, 1, 100, 500], ["img1", 50, 30], null, ["img2", 50, 30]],
        };
        const elements = extractGraphicsFromOperatorList(opList, PAGE_W, PAGE_H, OPS);
        expect(elements).toHaveLength(2);
        expect(elements[0].rect).toEqual({ x: 100, y: 500, width: 50, height: 30 });
        expect(elements[1].rect).toEqual({ x: 0, y: 0, width: 50, height: 30 });
    });

    it("忽略面积过小或整页的图形", () => {
        const opList: OperatorListLike = {
            fnArray: [OPS.constructPath, OPS.constructPath],
            argsArray: [
                [20, [], [0, 0, 1, 1]],           // 面积 1pt²，忽略
                [20, [], [0, 0, PAGE_W, PAGE_H]], // 整页，忽略
            ],
        };
        const elements = extractGraphicsFromOperatorList(opList, PAGE_W, PAGE_H, OPS);
        expect(elements).toHaveLength(0);
    });
});

describe("flipRectToTopDown", () => {
    it("y 自下而上转为自上而下", () => {
        const flipped = flipRectToTopDown({ x: 100, y: 600, width: 50, height: 30 }, PAGE_H);
        expect(flipped).toEqual({ x: 100, yTop: PAGE_H - 630, width: 50, height: 30 });
    });
});

describe("rectIntersects", () => {
    it("相交返回 true", () => {
        expect(rectIntersects(
            { x: 0, yTop: 0, width: 100, height: 100 },
            { x: 50, yTop: 50, width: 100, height: 100 },
        )).toBe(true);
    });

    it("不相交返回 false", () => {
        expect(rectIntersects(
            { x: 0, yTop: 0, width: 50, height: 50 },
            { x: 100, yTop: 100, width: 50, height: 50 },
        )).toBe(false);
    });
});

describe("regionHasGraphics", () => {
    it("区域与图形相交时返回 true", () => {
        const pageGraphics = new Map<number, Array<{ kind: "image" | "vector"; rect: { x: number; y: number; width: number; height: number } }>>([
            [1, [{ kind: "vector", rect: { x: 100, y: 600, width: 50, height: 30 } }]],
        ]);
        const has = regionHasGraphics(
            { page: 1, rect: { x: 0, yTop: PAGE_H - 650, width: PAGE_W, height: 100 } },
            pageGraphics,
            () => PAGE_H,
        );
        expect(has).toBe(true);
    });

    it("区域与图形不相交时返回 false", () => {
        const pageGraphics = new Map<number, Array<{ kind: "image" | "vector"; rect: { x: number; y: number; width: number; height: number } }>>([
            [1, [{ kind: "vector", rect: { x: 100, y: 600, width: 50, height: 30 } }]],
        ]);
        const has = regionHasGraphics(
            { page: 1, rect: { x: 0, yTop: 0, width: PAGE_W, height: 100 } },
            pageGraphics,
            () => PAGE_H,
        );
        expect(has).toBe(false);
    });
});
