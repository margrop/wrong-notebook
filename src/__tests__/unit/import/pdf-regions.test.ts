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

    it("最后一题收紧到最后一行文字底部，不截进页面下方空白", () => {
        const regions = computeQuestionRegions(4, 5, lines, singlePage, new Map(), headerFooterZones(singlePage));
        expect(regions).toHaveLength(1);
        expect(regions[0].rect.yTop).toBeCloseTo(500 - 4, 1);
        // 行高 12，上下各留 4
        expect(regions[0].rect.height).toBeCloseTo(12 + 8, 1);
    });

    it("最后一题下方的图形计入区域，延伸到图形底部", () => {
        const graphics = new Map([[1, [{ x: 100, yTop: 520, width: 200, height: 100 }]]]);
        const regions = computeQuestionRegions(4, 5, lines, singlePage, new Map(), headerFooterZones(singlePage), graphics);
        expect(regions[0].rect.yTop).toBeCloseTo(500 - 4, 1);
        expect(regions[0].rect.yTop + regions[0].rect.height).toBeCloseTo(620 + 4, 1);
    });
});

describe("computeQuestionRegions：跨页", () => {
    const pages = [singlePage[0], singlePage[0]];
    const lines = [
        makeLine("1. First question", 1, 600),
        makeLine("2. Second question on page two", 2, 150),
    ];

    it("下一题在下一页时，本题只取本页内容（收紧到最后一行）", () => {
        const regions = computeQuestionRegions(0, 1, lines, pages, new Map(), headerFooterZones(pages));
        expect(regions).toHaveLength(1);
        expect(regions[0].page).toBe(1);
        expect(regions[0].rect.yTop).toBeCloseTo(600 - 4, 1);
        expect(regions[0].rect.height).toBeCloseTo(12 + 8, 1);
    });

    it("第 2 页的最后一题：题号行顶部到最后一行底部", () => {
        const regions = computeQuestionRegions(1, 2, lines, pages, new Map(), headerFooterZones(pages));
        expect(regions).toHaveLength(1);
        expect(regions[0].page).toBe(2);
        expect(regions[0].rect.yTop).toBeCloseTo(150 - 4, 1);
        expect(regions[0].rect.height).toBeCloseTo(12 + 8, 1);
    });

    it("题目跨页延续时两段都保留，第 2 页段包含首行上方的配图", () => {
        const continued = [
            makeLine("1. Question spanning pages", 1, 700),
            makeLine("continued text on page two", 2, 300),
            makeLine("2. Next question", 2, 400),
        ];
        const graphics = new Map([[2, [{ x: 100, yTop: 150, width: 200, height: 120 }]]]);
        const regions = computeQuestionRegions(0, 2, continued, pages, new Map(), headerFooterZones(pages), graphics);
        expect(regions.map((region) => region.page)).toEqual([1, 2]);
        expect(regions[1].rect.yTop).toBeCloseTo(150 - 4, 1);
        expect(regions[1].rect.yTop + regions[1].rect.height).toBeCloseTo(400 - 4, 1);
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

describe("computeQuestionRegions：靠近页面顶部的题", () => {
    it("题目从页面顶部附近开始时不被页眉区比例裁掉（页眉行已在重建文字行时剔除）", () => {
        const lines = [makeLine("1. Near top question", 1, 50)];
        const regions = computeQuestionRegions(0, 1, lines, singlePage, new Map(), headerFooterZones(singlePage));
        expect(regions).toHaveLength(1);
        expect(regions[0].rect.yTop).toBeCloseTo(50 - 4, 1);
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

describe("题号行上方的公式行归入本题", () => {
    it("紧挨题号行且明显靠右的行并入本题区域，上一题区域止于其上方", () => {
        const lines = [
            makeLine("1. First question", 1, 100),
            makeLine("answer line", 1, 124),
            makeLine("a + b = 1", 1, 200, 220),
            makeLine("2. Solve the system", 1, 214),
            makeLine("c + d = 2", 1, 228, 220),
        ];
        const regions = computeAllQuestionRegions([{ from: 0, to: 3 }, { from: 3, to: 5 }], lines, singlePage);
        expect(regions[1]?.[0].rect.yTop).toBeCloseTo(200 - 4, 1);
        const first = regions[0]?.[0].rect;
        expect(first ? first.yTop + first.height : 0).toBeCloseTo(200 - 4, 1);
    });

    it("不靠右的普通上一行不会被并入", () => {
        const lines = [
            makeLine("1. First question", 1, 100),
            makeLine("last line of question one", 1, 200, 80),
            makeLine("2. Next question", 1, 214),
        ];
        const regions = computeAllQuestionRegions([{ from: 0, to: 2 }, { from: 2, to: 3 }], lines, singlePage);
        expect(regions[1]?.[0].rect.yTop).toBeCloseTo(214 - 4, 1);
    });
});
