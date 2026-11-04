/**
 * regions.ts 纯函数测试：单栏多题、跨页、双栏、页眉页脚排除、最后一题。
 */
import { describe, expect, it } from "vitest";
import type { PdfLine } from "@/lib/import/file-parsers/pdf/layout";
import {
    computeAllQuestionRegions,
    computeQuestionRegions,
    detectColumnSplits,
    headerFooterZones,
} from "@/lib/import/file-parsers/pdf/regions";

const PAGE_W = 612;
const PAGE_H = 792;

function makeLine(text: string, page: number, yTop: number, x = 72, height = 12): PdfLine {
    return { text, x, yTop, height, page };
}

const singlePage = [{ width: PAGE_W, height: PAGE_H }];

describe("detectColumnSplits", () => {
    it("单栏页面不返回切分", () => {
        const lines = [
            makeLine("1. Question one", 1, 72),
            makeLine("2. Question two", 1, 144),
        ];
        expect(detectColumnSplits(lines, singlePage).size).toBe(0);
    });

    it("左右各有文字且中缝空白时判定为双栏", () => {
        const lines = [
            makeLine("Left column text", 1, 72, 50),
            makeLine("Right column text", 1, 72, 350),
        ];
        const splits = detectColumnSplits(lines, singlePage);
        expect(splits.has(1)).toBe(true);
        expect(splits.get(1)?.boundaries).toEqual([PAGE_W / 2]);
    });
});

describe("headerFooterZones", () => {
    it("返回每页顶部 15% 与底部 92% 的排除带", () => {
        const zones = headerFooterZones(singlePage);
        expect(zones.get(1)).toEqual({ top: PAGE_H * 0.15, bottom: PAGE_H * 0.92 });
    });
});

describe("computeQuestionRegions：单栏多题", () => {
    const lines = [
        makeLine("1. What is 2+2?", 1, 150),
        makeLine("A. 3  B. 4", 1, 174),
        makeLine("2. Solve: 3x = 9", 1, 300),
        makeLine("Answer: x = 3", 1, 324),
        makeLine("3. Final question", 1, 500),
    ];

    it("题 1 区域：题号行顶部到题 2 首行顶部", () => {
        const regions = computeQuestionRegions(0, 2, lines, singlePage, new Map(), headerFooterZones(singlePage));
        expect(regions).toHaveLength(1);
        expect(regions[0].page).toBe(1);
        expect(regions[0].rect.yTop).toBeCloseTo(150 - 4, 1);
        expect(regions[0].rect.height).toBeCloseTo(300 - 150, 1);
        expect(regions[0].rect.x).toBe(0);
        expect(regions[0].rect.width).toBe(PAGE_W);
    });

    it("题 2 区域：题号行顶部到题 3 首行顶部", () => {
        const regions = computeQuestionRegions(2, 4, lines, singlePage, new Map(), headerFooterZones(singlePage));
        expect(regions).toHaveLength(1);
        expect(regions[0].rect.yTop).toBeCloseTo(300 - 4, 1);
        expect(regions[0].rect.height).toBeCloseTo(500 - 300, 1);
    });

    it("最后一题延伸到页脚区顶部", () => {
        const regions = computeQuestionRegions(4, 5, lines, singlePage, new Map(), headerFooterZones(singlePage));
        expect(regions).toHaveLength(1);
        expect(regions[0].rect.yTop).toBeCloseTo(500 - 4, 1);
        expect(regions[0].rect.height).toBeCloseTo(PAGE_H * 0.92 - (500 - 4), 1);
    });
});

describe("computeQuestionRegions：跨页", () => {
    const pages = [singlePage[0], singlePage[0]];
    const lines = [
        makeLine("1. First question", 1, 600),
        makeLine("2. Second question on page two", 2, 150),
    ];

    it("拆成两段：第 1 页底部 + 第 2 页顶部", () => {
        const regions = computeQuestionRegions(0, 1, lines, pages, new Map(), headerFooterZones(pages));
        expect(regions).toHaveLength(1);
        expect(regions[0].page).toBe(1);
        expect(regions[0].rect.yTop).toBeCloseTo(600 - 4, 1);
        expect(regions[0].rect.height).toBeCloseTo(PAGE_H * 0.92 - (600 - 4), 1);
    });

    it("第 2 页题区域：题号行顶部到页脚区顶部（最后一题）", () => {
        const regions = computeQuestionRegions(1, 2, lines, pages, new Map(), headerFooterZones(pages));
        expect(regions).toHaveLength(1);
        expect(regions[0].page).toBe(2);
        expect(regions[0].rect.yTop).toBeCloseTo(150 - 4, 1);
        expect(regions[0].rect.height).toBeCloseTo(PAGE_H * 0.92 - (150 - 4), 1);
    });
});

describe("computeQuestionRegions：双栏", () => {
    const lines = [
        makeLine("1. Left question", 1, 72, 50),
        makeLine("2. Right question", 1, 72, 350),
        makeLine("More right text", 1, 96, 350),
    ];
    const splits = detectColumnSplits(lines, singlePage);
    const zones = headerFooterZones(singlePage);

    it("左右栏各自独立成段，边界取栏宽", () => {
        const leftRegions = computeQuestionRegions(0, 1, lines, singlePage, splits, zones);
        expect(leftRegions).toHaveLength(1);
        expect(leftRegions[0].rect.x).toBe(0);
        expect(leftRegions[0].rect.width).toBeCloseTo(PAGE_W / 2, 1);

        const rightRegions = computeQuestionRegions(1, 3, lines, singlePage, splits, zones);
        expect(rightRegions).toHaveLength(1);
        expect(rightRegions[0].rect.x).toBeCloseTo(PAGE_W / 2, 1);
        expect(rightRegions[0].rect.width).toBeCloseTo(PAGE_W / 2, 1);
    });
});

describe("computeQuestionRegions：页眉页脚排除", () => {
    it("区域顶部被钳制在页眉区底部", () => {
        const lines = [makeLine("1. Near top question", 1, 50)];
        const regions = computeQuestionRegions(0, 1, lines, singlePage, new Map(), headerFooterZones(singlePage));
        expect(regions).toHaveLength(1);
        expect(regions[0].rect.yTop).toBeCloseTo(PAGE_H * 0.15, 1);
    });
});

describe("computeAllQuestionRegions", () => {
    it("与题目下标一一对应；lineRange 越界时为 null", () => {
        const lines = [
            makeLine("1. Question one", 1, 72),
            makeLine("2. Question two", 1, 200),
        ];
        const regions = computeAllQuestionRegions(
            [{ from: 0, to: 1 }, { from: 1, to: 2 }, undefined, { from: 99, to: 100 }],
            lines,
            singlePage,
        );
        expect(regions).toHaveLength(4);
        expect(regions[0]).not.toBeNull();
        expect(regions[1]).not.toBeNull();
        expect(regions[2]).toBeNull();
        expect(regions[3]).toBeNull();
    });
});
