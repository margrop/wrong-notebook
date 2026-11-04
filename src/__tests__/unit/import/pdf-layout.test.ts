/**
 * PDF 文字层布局纯函数（layout.ts）单元测试：
 * 行还原（同 y 聚类、按 x 拼接、间距补空格）、双栏检测、页眉页脚移除、连字归一。
 * 输入为构造的 { str, x, y, width, height, page } 数组，不依赖 pdfjs。
 */
import { describe, expect, it } from "vitest";
import { normalizePdfText, reconstructLines } from "@/lib/import/file-parsers/pdf/layout";
import type { PdfTextItem } from "@/lib/import/file-parsers/pdf/layout";

const PAGE_W = 612;
const PAGE_H = 792;

/** 便捷构造文字项：yTop 为自上而下位置（与 PDF 原生 y 方向相反，便于按阅读顺序写用例） */
function item(str: string, x: number, yTop: number, width = str.length * 6, height = 12, page = 1): PdfTextItem {
    return { str, x, y: PAGE_H - yTop, width, height, page };
}

/** 单页尺寸 */
const pages = [{ width: PAGE_W, height: PAGE_H }];

describe("normalizePdfText：连字与全角空格归一", () => {
    it("常见连字展开", () => {
        expect(normalizePdfText("ﬁle ﬂag ﬀord")).toBe("file flag fford");
        expect(normalizePdfText("ﬃﬄ")).toBe("ffiffl");
    });

    it("不换行空格与全角空格归一为半角空格", () => {
        expect(normalizePdfText("a b　c")).toBe("a b c");
    });
});

describe("reconstructLines：行还原", () => {
    it("同一 y 的多个文字项按 x 拼接为一行", () => {
        const lines = reconstructLines([
            item("1. What is ", 72, 100, 66),
            item("2+2", 138, 100, 24),
        ], pages);
        expect(lines).toHaveLength(1);
        expect(lines[0].text).toBe("1. What is 2+2");
        expect(lines[0].page).toBe(1);
    });

    it("不同 y 分成两行，按自上而下排序", () => {
        const lines = reconstructLines([
            item("second line", 72, 200),
            item("first line", 72, 100),
        ], pages);
        expect(lines.map((line) => line.text)).toEqual(["first line", "second line"]);
    });

    it("同项间距较大时补空格", () => {
        // 第二项起点远在第一项文字末尾之后（> 0.15 字号），应补一个空格
        const lines = reconstructLines([
            item("A.", 72, 100, 12),
            item("option text", 110, 100),
        ], pages);
        expect(lines[0].text).toBe("A. option text");
    });

    it("中文字项之间不补空格", () => {
        const lines = reconstructLines([
            item("计算：", 72, 100, 36),
            item("二十四", 108, 100, 36),
            item("加十八", 144, 100, 36),
        ], pages);
        expect(lines[0].text).toBe("计算：二十四加十八");
    });

    it("跨页拼接：先页 1 后页 2", () => {
        const lines = reconstructLines([
            item("page two line", 72, 100, 0, 12, 2),
            item("page one line", 72, 100, 0, 12, 1),
        ], pages);
        expect(lines.map((line) => line.text)).toEqual(["page one line", "page two line"]);
    });
});

describe("reconstructLines：双栏检测", () => {
    it("左右两栏各自有文字且中缝空白时，先左栏后右栏", () => {
        const items: PdfTextItem[] = [];
        // 左栏两行（y 间隔大于行容差 0.5*12=6，避免被合并）
        items.push(item("left line 1", 72, 100, 66, 12, 1));
        items.push(item("left line 2", 72, 140, 66, 12, 1));
        // 右栏两行（与左栏 y 交错，若按纯 y 排序会打乱）
        items.push(item("right line 1", 360, 108, 70, 12, 1));
        items.push(item("right line 2", 360, 148, 70, 12, 1));
        const lines = reconstructLines(items, pages);
        expect(lines.map((line) => line.text)).toEqual([
            "left line 1",
            "left line 2",
            "right line 1",
            "right line 2",
        ]);
    });

    it("中缝有贯穿文字时不视为双栏（跨栏大标题）", () => {
        const items: PdfTextItem[] = [];
        // 跨栏标题（x 从 72 到 540）
        items.push(item("Full width title across both columns", 72, 80, 468, 12, 1));
        items.push(item("left line", 72, 130, 60, 12, 1));
        items.push(item("right line", 340, 130, 66, 12, 1));
        const lines = reconstructLines(items, pages);
        // 不是双栏：按 yTop 排，标题在最上
        expect(lines[0].text).toBe("Full width title across both columns");
    });
});

describe("reconstructLines：页眉页脚移除", () => {
    it("多页顶部相同文字（忽略页码差异）视为页眉并移除", () => {
        const threePages = [pages[0], pages[0], pages[0]];
        const items: PdfTextItem[] = [];
        // 每页页眉（页码不同）+ 正文
        items.push(item("Chapter 1 Page 1", 72, 40, 120, 12, 1));
        items.push(item("Chapter 1 Page 2", 72, 40, 120, 12, 2));
        items.push(item("Chapter 1 Page 3", 72, 40, 120, 12, 3));
        items.push(item("question one body", 72, 200, 120, 12, 1));
        items.push(item("question two body", 72, 200, 120, 12, 2));
        items.push(item("question three body", 72, 200, 120, 12, 3));
        const lines = reconstructLines(items, threePages);
        expect(lines.map((line) => line.text)).toEqual([
            "question one body",
            "question two body",
            "question three body",
        ]);
    });

    it("底部页脚（含页码）同样移除", () => {
        const twoPages = [pages[0], pages[0]];
        const items: PdfTextItem[] = [
            item("- 1 -", 280, 760, 30, 12, 1),
            item("- 2 -", 280, 760, 30, 12, 2),
            item("body line one", 72, 200, 90, 12, 1),
            item("body line two", 72, 200, 90, 12, 2),
        ];
        const lines = reconstructLines(items, twoPages);
        expect(lines.map((line) => line.text)).toEqual(["body line one", "body line two"]);
    });

    it("仅出现一次的顶部文字不是页眉，保留", () => {
        const items: PdfTextItem[] = [
            item("First page title only", 72, 40, 140, 12, 1),
            item("body", 72, 200, 30, 12, 1),
        ];
        const lines = reconstructLines(items, pages);
        expect(lines.map((line) => line.text)).toEqual(["First page title only", "body"]);
    });
});
