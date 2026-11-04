/**
 * PDF 题库解析器单元测试（parsePdf）。
 * 用手写最小 PDF（src/__tests__/helpers/pdf-fixture.ts，Type1 Helvetica 英文与数字）作夹具：
 * 多题分题、多页拼接、页眉页脚移除、无文字层报 PDF_NO_TEXT_LAYER、损坏文件报 INVALID_PDF。
 * 中文与双栏场景由 pdf-layout.test.ts 用构造数据覆盖。
 */
import { describe, expect, it } from "vitest";
import { makeCorruptPdfBuffer, makePdfBuffer } from "@/__tests__/helpers/pdf-fixture";
import { nodePdfOptions } from "@/__tests__/helpers/pdf-node";
import { parsePdf } from "@/lib/import/file-parsers/pdf";

describe("parsePdf：多题分题", () => {
    it("识别两道编号题并给出 label", async () => {
        const buffer = makePdfBuffer([
            { lines: [
                { text: "1. What is 2+2?", y: 72 },
                { text: "A. 3  B. 4", y: 96 },
                { text: "2. Solve: 3x = 9", y: 150 },
                { text: "Answer: x = 3", y: 174 },
            ] },
        ]);
        const result = await parsePdf(buffer, await nodePdfOptions());
        expect(result.errors).toEqual([]);
        expect(result.questions).toHaveLength(2);
        expect(result.questions[0].label).toBe("1");
        expect(result.questions[0].text).toContain("What is 2+2?");
        expect(result.questions[1].label).toBe("2");
        expect(result.questions[1].text).toContain("Solve: 3x = 9");
        expect(result.warnings).toContain("PAGES:1");
    });
});

describe("parsePdf：多页拼接", () => {
    it("第 2 页的题目接到第 1 页之后", async () => {
        const buffer = makePdfBuffer([
            { lines: [
                { text: "1. First question on page one", y: 72 },
                { text: "2. Second question on page one", y: 120 },
            ] },
            { lines: [
                { text: "3. Third question on page two", y: 72 },
            ] },
        ]);
        const result = await parsePdf(buffer, await nodePdfOptions());
        expect(result.errors).toEqual([]);
        expect(result.questions).toHaveLength(3);
        expect(result.questions[2].label).toBe("3");
        expect(result.questions[2].text).toContain("Third question on page two");
        expect(result.warnings).toContain("PAGES:2");
    });
});

describe("parsePdf：页眉页脚移除", () => {
    it("多页相同的页眉（页码不同）被移除，不混入题目", async () => {
        const header = (n: number) => `Math Exam Paper - Page ${n} of 3`;
        const buffer = makePdfBuffer([
            { lines: [
                { text: header(1), y: 40 },
                { text: "1. Question on page one", y: 100 },
            ] },
            { lines: [
                { text: header(2), y: 40 },
                { text: "2. Question on page two", y: 100 },
            ] },
            { lines: [
                { text: header(3), y: 40 },
                { text: "3. Question on page three", y: 100 },
            ] },
        ]);
        const result = await parsePdf(buffer, await nodePdfOptions());
        expect(result.errors).toEqual([]);
        expect(result.questions).toHaveLength(3);
        for (const question of result.questions) {
            expect(question.text).not.toContain("Math Exam Paper");
        }
    });
});

describe("parsePdf：无文字层", () => {
    it("每页文字量过少时返回 PDF_NO_TEXT_LAYER", async () => {
        // 每页只有一行短文字（少于 20 字符），视为扫描版
        const buffer = makePdfBuffer([
            { lines: [{ text: "Hi", y: 72 }] },
            { lines: [{ text: "Ok", y: 72 }] },
        ]);
        const result = await parsePdf(buffer, await nodePdfOptions());
        expect(result.questions).toEqual([]);
        expect(result.errors).toEqual([{ index: -1, reason: "PDF_NO_TEXT_LAYER" }]);
        expect(result.warnings).toContain("PAGES:2");
    });
});

describe("parsePdf：损坏文件", () => {
    it("损坏的 PDF 返回 INVALID_PDF", async () => {
        const result = await parsePdf(makeCorruptPdfBuffer());
        expect(result.questions).toEqual([]);
        expect(result.errors).toEqual([{ index: -1, reason: "INVALID_PDF" }]);
    });
});

describe("parsePdf：版面区域与图形检测", () => {
    it("无图形的 PDF：pdfHasGraphics 为 false，pdfRegions 与题数对齐", async () => {
        const buffer = makePdfBuffer([
            { lines: [
                { text: "1. What is the sum of 2 and 2?", y: 150 },
                { text: "2. Solve the equation 3x = 9 for x", y: 300 },
            ] },
        ]);
        const result = await parsePdf(buffer, await nodePdfOptions());
        expect(result.questions).toHaveLength(2);
        expect(result.pdfHasGraphics).toBe(false);
        expect(result.pdfRegions).toHaveLength(2);
        expect(result.pdfRegions?.[0]).not.toBeNull();
        expect(result.pdfRegions?.[1]).not.toBeNull();
    });

    it("含矩形图形的 PDF：pdfHasGraphics 为 true，图形元素被检出", async () => {
        const buffer = makePdfBuffer([
            { lines: [
                { text: "1. What is the sum of 2 and 2?", y: 150 },
                { text: "2. Solve the equation 3x = 9 for x", y: 300 },
            ], rects: [
                { x: 100, y: 200, width: 200, height: 80, strokeGray: 0 },
            ] },
        ]);
        const result = await parsePdf(buffer, await nodePdfOptions());
        expect(result.questions).toHaveLength(2);
        expect(result.pdfHasGraphics).toBe(true);
        expect(result.pdfPageGraphics).toBeDefined();
        expect(result.pdfPageGraphics?.[0]).toHaveLength(1);
        expect(result.pdfPageGraphics?.[0]?.[0].kind).toBe("vector");
    });

    it("含图片 XObject 的 PDF：检出图片图形", async () => {
        const imageData = new Uint8Array([255, 0, 0, 0, 255, 0]);
        const buffer = makePdfBuffer([
            { lines: [
                { text: "1. Look at the image and describe it briefly", y: 150 },
            ], images: [
                { x: 100, y: 200, width: 120, height: 90, data: imageData, pixelWidth: 1, pixelHeight: 2 },
            ] },
        ]);
        const result = await parsePdf(buffer, await nodePdfOptions());
        expect(result.pdfHasGraphics).toBe(true);
        expect(result.pdfPageGraphics?.[0]?.[0].kind).toBe("image");
    });

    it("pdfRegions 与 questions 下标一一对应（含错误题时）", async () => {
        // 第 1 题正常，第 2 题只有题号没有正文（normalizeQuestion 会报错）
        const buffer = makePdfBuffer([
            { lines: [
                { text: "1. Valid question here with enough text", y: 150 },
                { text: "2.", y: 300 },
            ] },
        ]);
        const result = await parsePdf(buffer, await nodePdfOptions());
        // 第 2 题 text 为空，parseQuestionFile 会报错误
        expect(result.questions.length).toBe(1);
        expect(result.pdfRegions).toHaveLength(1);
    });
});
