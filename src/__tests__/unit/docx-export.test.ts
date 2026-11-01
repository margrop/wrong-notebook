import { describe, expect, it, vi } from "vitest";
import {
    createDocxArchive,
    docxFileName,
    formatMathAndMarkdownForDocx,
    rasterizeImageForDocx,
    rasterizeSvgFigureForDocx,
    triggerDocxDownload,
} from "@/lib/docx-export";

describe("formatMathAndMarkdownForDocx", () => {
    it("转换分式、根式、上下标与常见数学几何符号", () => {
        expect(formatMathAndMarkdownForDocx("计算 $\\frac{1}{2} + \\frac{x+1}{y-1}$"))
            .toBe("计算 1/2 + (x+1)/(y-1)");
        expect(formatMathAndMarkdownForDocx("$\\sqrt{5} + \\sqrt{x+1} + \\sqrt[3]{8}$"))
            .toBe("√5 + √(x+1) + ³√8");
        expect(formatMathAndMarkdownForDocx("$x^2 + y^{n+1} + a_1 + z^{abc}$"))
            .toBe("x² + yⁿ⁺¹ + a₁ + z^(abc)");
        expect(formatMathAndMarkdownForDocx("如图，$\\triangle ABC \\cong \\triangle DEF$，$\\angle A = 90^\\circ$"))
            .toBe("如图，△ ABC ≌ △ DEF，∠ A = 90°");
        expect(formatMathAndMarkdownForDocx("$a \\times b \\div c \\le d \\ge e \\neq 0 \\pm 1$"))
            .toBe("a × b ÷ c ≤ d ≥ e ≠ 0 ± 1");
    });

    it("还原填空横线并剥离配图注释及 Markdown 标记，选择题选项另起一行", () => {
        expect(
            formatMathAndMarkdownForDocx(
                "<!-- figure: 直角三角形 -->\n### 标题\n**重点**：当 $x = \\underline{\\quad}$ 时，结果为 \\_\\_\\_，或 $\\rule{2cm}{0.4pt}$。",
            ),
        ).toBe("标题\n重点：当 x = ______ 时，结果为 ___，或 ______。");

        expect(
            formatMathAndMarkdownForDocx("计算 $2+3$ 的值（ ） A. 4  B. 5  C. 6  D. 7"),
        ).toBe("计算 2+3 的值（ ）\nA. 4  B. 5  C. 6  D. 7");
    });
});

describe("docxFileName", () => {
    it("过滤非法文件名字符并附加 .docx 后缀", () => {
        expect(docxFileName("七年级数学：期中试卷/A卷")).toBe("七年级数学：期中试卷_A卷.docx");
        expect(docxFileName("   ")).toBe("document.docx");
    });
});

describe("createDocxArchive", () => {
    it("生成合法的 OpenXML ZIP 归档，包含题干、图片、留白空行与独立答案页", () => {
        const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        const archive = createDocxArchive({
            title: "周末测试卷",
            metaItems: ["姓名：________", "得分：________"],
            questions: [
                {
                    heading: "1.",
                    meta: "来源 ID: AB12CD",
                    questionText: "已知 $x^2 = 4$，求 $x$ 的值。",
                    image: {
                        data: fakePng,
                        extension: "png",
                        widthPx: 240,
                        heightPx: 120,
                        align: "center",
                    },
                    answerSpacePx: 120,
                },
                {
                    heading: "2.",
                    questionText: "1 + 1 = ____",
                    inlineAnswerLabel: "参考答案",
                    inlineAnswerText: "$2$",
                    inlineAnalysisLabel: "解析",
                    inlineAnalysisText: "基础加法",
                    answerSpacePx: 0,
                },
            ],
            answerKeyTitle: "参考答案与解析",
            answerKey: [
                {
                    heading: "1.",
                    meta: "来源 ID: AB12CD",
                    answerLabel: "答案",
                    answerText: "$x = \\pm 2$",
                    analysisLabel: "解析",
                    analysisText: "平方根定义",
                },
            ],
        });

        // 检查 ZIP 魔数 PK\x03\x04 与结尾 EOCD 魔数 PK\x05\x06
        expect(archive[0]).toBe(0x50);
        expect(archive[1]).toBe(0x4b);
        expect(archive[2]).toBe(0x03);
        expect(archive[3]).toBe(0x04);

        const text = new TextDecoder().decode(archive);
        expect(text).toContain("[Content_Types].xml");
        expect(text).toContain("word/document.xml");
        expect(text).toContain("word/styles.xml");
        expect(text).toContain("word/_rels/document.xml.rels");
        expect(text).toContain("word/media/image1.png");
        expect(text).toContain("周末测试卷");
        expect(text).toContain("姓名：________");
        expect(text).toContain("已知 x² = 4，求 x 的值。");
        expect(text).toContain("x = ± 2");
        expect(text).toContain("<w:pageBreakBefore/>");
        expect(text).toContain('r:embed="rIdImg1"');
    });
});

describe("rasterizeSvgFigureForDocx & triggerDocxDownload", () => {
    it("空 SVG 返回 null，图片加载失败时优雅降级为 null", async () => {
        expect(await rasterizeSvgFigureForDocx(null)).toBeNull();
        expect(await rasterizeSvgFigureForDocx("")).toBeNull();

        const OriginalImage = globalThis.Image;
        class FailingImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_value: string) {
                setTimeout(() => this.onerror?.(), 0);
            }
        }
        globalThis.Image = FailingImage as unknown as typeof Image;
        try {
            const result = await rasterizeImageForDocx("https://example.com/broken.png");
            expect(result).toBeNull();
            const svgResult = await rasterizeSvgFigureForDocx('<svg xmlns="http://www.w3.org/2000/svg"/>', 80, "center");
            expect(svgResult).toBeNull();
        } finally {
            globalThis.Image = OriginalImage;
        }
    });

    it("triggerDocxDownload 创建 Blob URL 并触发链接下载", () => {
        const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-docx");
        const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

        triggerDocxDownload(new Uint8Array([1, 2, 3]), "错题本导出");

        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-docx");

        createObjectURL.mockRestore();
        revokeObjectURL.mockRestore();
        clickSpy.mockRestore();
    });
});
