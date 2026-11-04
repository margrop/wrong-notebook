import { describe, expect, it } from "vitest";
import {
    computeCompositeLayout,
    computeCompositeSize,
    computeImageOffsets,
    computeOutputSize,
    scaleToWidth,
    composeQuestionImage,
    IMAGE_GAP,
    QUESTION_IMAGE_MAX_LONG_EDGE,
} from "@/lib/import/question-images";
import type { ImageRenderer, SourceImage } from "@/lib/import/question-images";

describe("scaleToWidth", () => {
    it("等比缩放到目标宽度", () => {
        expect(scaleToWidth(800, 600, 400)).toEqual({ width: 400, height: 300 });
    });

    it("目标宽度大于原宽度时放大", () => {
        expect(scaleToWidth(200, 100, 400)).toEqual({ width: 400, height: 200 });
    });

    it("宽度为 0 时不产生 NaN", () => {
        const result = scaleToWidth(0, 100, 400);
        expect(result.width).toBe(400);
        expect(result.height).toBe(0);
    });
});

describe("computeCompositeSize", () => {
    it("单张图：无间距", () => {
        expect(computeCompositeSize([{ width: 400, height: 300 }])).toEqual({ width: 400, height: 300 });
    });

    it("多张图：宽度取最大，高度为各图高度之和加间距", () => {
        const images = [
            { width: 400, height: 300 },
            { width: 400, height: 200 },
            { width: 400, height: 100 },
        ];
        expect(computeCompositeSize(images)).toEqual({
            width: 400,
            height: 300 + 200 + 100 + IMAGE_GAP * 2,
        });
    });

    it("空数组返回 0x0", () => {
        expect(computeCompositeSize([])).toEqual({ width: 0, height: 0 });
    });
});

describe("computeImageOffsets", () => {
    it("计算每张图的纵向偏移", () => {
        const images = [
            { width: 400, height: 300 },
            { width: 400, height: 200 },
        ];
        expect(computeImageOffsets(images)).toEqual([0, 300 + IMAGE_GAP]);
    });
});

describe("computeOutputSize", () => {
    it("长边不超过上限时不缩放", () => {
        expect(computeOutputSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    });

    it("长边超过上限时等比缩小", () => {
        const result = computeOutputSize(2000, 1000, 1600);
        expect(result).toEqual({ width: 1600, height: 800 });
    });

    it("竖向图片也按长边限制", () => {
        const result = computeOutputSize(1000, 3000, 1600);
        expect(result.height).toBe(1600);
        expect(result.width).toBe(Math.round(1000 * (1600 / 3000)));
    });
});

describe("computeCompositeLayout", () => {
    it("计算完整合成布局", () => {
        const images = [
            { width: 800, height: 600 },
            { width: 400, height: 300 },
        ];
        const layout = computeCompositeLayout(images);
        // 两张图都缩放到最大宽度 800
        expect(layout.canvasWidth).toBe(800);
        // 第一张高度 600，第二张等比缩放到 800 宽 → 高度 600
        expect(layout.canvasHeight).toBe(600 + 600 + IMAGE_GAP);
        expect(layout.placements).toHaveLength(2);
        expect(layout.placements[0]).toEqual({ width: 800, height: 600, y: 0 });
        expect(layout.placements[1]).toEqual({ width: 800, height: 600, y: 600 + IMAGE_GAP });
    });

    it("等宽缩放：较窄的图放大到最大宽度", () => {
        const images = [
            { width: 400, height: 200 },
            { width: 800, height: 400 },
        ];
        const layout = computeCompositeLayout(images);
        // 第一张缩放到 800 宽 → 高度 400
        expect(layout.placements[0]).toEqual({ width: 800, height: 400, y: 0 });
        expect(layout.placements[1]).toEqual({ width: 800, height: 400, y: 400 + IMAGE_GAP });
    });
});

describe("composeQuestionImage", () => {
    const fakeRenderer: ImageRenderer = {
        async renderComposite(images: SourceImage[], layout) {
            // 假实现：返回布局描述
            return `composite:${layout.canvasWidth}x${layout.canvasHeight}:${images.length}`;
        },
        async renderSingle(image: SourceImage, maxLongEdge: number) {
            return `single:${image.width}x${image.height}:${maxLongEdge}`;
        },
    };

    it("单张图走 renderSingle", async () => {
        const source: SourceImage = { source: {} as CanvasImageSource, width: 800, height: 600 };
        const result = await composeQuestionImage([source], fakeRenderer);
        expect(result).toBe(`single:800x600:${QUESTION_IMAGE_MAX_LONG_EDGE}`);
    });

    it("多张图走 renderComposite", async () => {
        const sources: SourceImage[] = [
            { source: {} as CanvasImageSource, width: 400, height: 300 },
            { source: {} as CanvasImageSource, width: 400, height: 200 },
        ];
        const result = await composeQuestionImage(sources, fakeRenderer);
        expect(result).toContain("composite:");
        expect(result).toContain("2");
    });

    it("空数组抛错", async () => {
        await expect(composeQuestionImage([], fakeRenderer)).rejects.toThrow("NO_IMAGES");
    });
});
