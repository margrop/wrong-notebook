/**
 * to-docx.ts 的单元测试：
 * 1. 纯函数：中文数字、图片尺寸读取（PNG/JPEG 头）、等比缩放、data URL 解码、分组；
 * 2. buildDocxParagraphs 结构：标题、分组大题标题、题号连续、答案部分开关、图片插入；
 * 3. 往返测试——生成的 .docx 用 fflate 解压检查 document.xml 与 word/media/，
 *    再经 parseDocx 解析，题干与题数能还原，答案按题号回填。
 */
import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import {
    buildDocxParagraphs,
    dataUrlToImageBytes,
    groupQuestions,
    readImageSize,
    scaleToMaxWidth,
    toChineseNumber,
} from "@/lib/question-format/to-docx";
import { parseDocx } from "@/lib/import/file-parsers/docx";
import type { StructuredQuestion } from "@/lib/question-format/types";

/** 最小合法 PNG（1x1 透明像素）的 base64 */
const PNG_1X1_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** 构造 1x1 PNG 的 data URL */
function pngDataUrl(base64: string = PNG_1X1_BASE64): string {
    return `data:image/png;base64,${base64}`;
}

const sampleQuestions: StructuredQuestion[] = [
    {
        text: "下列哪个选项是正确的？\nA．选项一\nB．选项二",
        answer: "A",
        analysis: "这是解析内容。",
        section: "选择题",
        questionType: "single_choice",
    },
    {
        text: "1+1=____。",
        answer: "2",
        analysis: "基础加法运算。",
        section: "选择题",
        questionType: "fill_blank",
    },
    {
        text: "简述勾股定理。",
        answer: "直角三角形两直角边平方和等于斜边平方。",
        section: "解答题",
    },
];

describe("toChineseNumber", () => {
    it("基本转换", () => {
        expect(toChineseNumber(1)).toBe("一");
        expect(toChineseNumber(3)).toBe("三");
        expect(toChineseNumber(10)).toBe("十");
        expect(toChineseNumber(12)).toBe("十二");
        expect(toChineseNumber(20)).toBe("二十");
        expect(toChineseNumber(25)).toBe("二十五");
        expect(toChineseNumber(100)).toBe("一百");
        expect(toChineseNumber(110)).toBe("一百一十");
    });
});

describe("readImageSize", () => {
    it("读取 PNG 头部尺寸", () => {
        const bytes = dataUrlToImageBytes(pngDataUrl());
        expect(bytes).not.toBeNull();
        expect(bytes?.widthPx).toBe(1);
        expect(bytes?.heightPx).toBe(1);
    });

    it("非图片字节返回 null", () => {
        expect(readImageSize(new Uint8Array([1, 2, 3]))).toBeNull();
        // 只有 PNG 签名但长度不足
        expect(readImageSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    });

    it("构造的 PNG 宽高正确", () => {
        // 手工构造 100x50 的 PNG 头（不需要完整文件，只读 IHDR）
        const header = new Uint8Array(24);
        header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
        // IHDR 长度与标记
        header.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
        const view = new DataView(header.buffer);
        view.setUint32(16, 100, false);
        view.setUint32(20, 50, false);
        expect(readImageSize(header)).toEqual({ width: 100, height: 50 });
    });
});

describe("scaleToMaxWidth", () => {
    it("不超限时原样返回", () => {
        expect(scaleToMaxWidth(100, 50, 480)).toEqual({ width: 100, height: 50 });
    });

    it("超限时等比缩小", () => {
        expect(scaleToMaxWidth(960, 480, 480)).toEqual({ width: 480, height: 240 });
    });

    it("极高图高度最小为 1", () => {
        const result = scaleToMaxWidth(10000, 1, 480);
        expect(result.width).toBe(480);
        expect(result.height).toBeGreaterThanOrEqual(1);
    });
});

describe("dataUrlToImageBytes", () => {
    it("解码 PNG data URL", () => {
        const result = dataUrlToImageBytes(pngDataUrl());
        expect(result).not.toBeNull();
        expect(result?.type).toBe("png");
        expect(result?.bytes.length).toBeGreaterThan(0);
    });

    it("webp 返回 null（docx 不支持）", () => {
        const result = dataUrlToImageBytes(`data:image/webp;base64,${PNG_1X1_BASE64}`);
        expect(result).toBeNull();
    });

    it("非 data URL 返回 null", () => {
        expect(dataUrlToImageBytes("https://example.com/a.png")).toBeNull();
        expect(dataUrlToImageBytes("data:text/plain;base64,AAAA")).toBeNull();
    });
});

describe("groupQuestions", () => {
    it("按 section 分组，无 section 按题型", () => {
        const groups = groupQuestions(sampleQuestions);
        expect(groups).toHaveLength(2);
        expect(groups[0].heading).toBe("选择题");
        expect(groups[0].items).toHaveLength(2);
        expect(groups[1].heading).toBe("解答题");
        expect(groups[1].items).toHaveLength(1);
        // 题号连续
        expect(groups[0].items[0].number).toBe(1);
        expect(groups[0].items[1].number).toBe(2);
        expect(groups[1].items[0].number).toBe(3);
    });

    it("无 section 无题型时不分组", () => {
        const groups = groupQuestions([{ text: "a" }, { text: "b" }]);
        expect(groups).toHaveLength(1);
        expect(groups[0].heading).toBeNull();
    });
});

describe("buildDocxParagraphs", () => {
    it("包含标题与分组大题标题", () => {
        const paragraphs = buildDocxParagraphs(sampleQuestions, { title: "测试试卷" });
        const allText = JSON.stringify(paragraphs);
        expect(allText).toContain("测试试卷");
        expect(allText).toContain("第一大题 选择题");
        expect(allText).toContain("第二大题 解答题");
    });

    it("题号连续", () => {
        const paragraphs = buildDocxParagraphs(sampleQuestions, {});
        const allText = JSON.stringify(paragraphs);
        expect(allText).toContain("1. 下列哪个选项是正确的？");
        expect(allText).toContain("2. 1+1=____。");
        expect(allText).toContain("3. 简述勾股定理。");
    });

    it("答案部分开关：默认开启含参考答案", () => {
        const paragraphs = buildDocxParagraphs(sampleQuestions, {});
        const allText = JSON.stringify(paragraphs);
        expect(allText).toContain("参考答案");
        expect(allText).toContain("解析：这是解析内容。");
    });

    it("答案部分开关：关闭时不含参考答案", () => {
        const paragraphs = buildDocxParagraphs(sampleQuestions, { includeAnswers: false });
        const allText = JSON.stringify(paragraphs);
        expect(allText).not.toContain("参考答案");
    });

    it("包含原图时插入图片段", () => {
        const withImage: StructuredQuestion[] = [
            { text: "看图作答。", images: [{ dataUrl: pngDataUrl() }] },
        ];
        const paragraphs = buildDocxParagraphs(withImage, { includeImages: true });
        const allText = JSON.stringify(paragraphs);
        expect(allText).toContain("image");
    });

    it("不含原图时不插入图片段", () => {
        const withImage: StructuredQuestion[] = [
            { text: "看图作答。", images: [{ dataUrl: pngDataUrl() }] },
        ];
        const paragraphs = buildDocxParagraphs(withImage, { includeImages: false });
        const allText = JSON.stringify(paragraphs);
        expect(allText).not.toContain("image");
    });
});

describe("导出→导入往返", () => {
    it("生成的 .docx 经 parseDocx 解析能还原题干与题数，答案按题号回填", async () => {
        const { buildQuestionsDocx } = await import("@/lib/question-format/to-docx");
        const blob = await buildQuestionsDocx(sampleQuestions, { title: "往返测试" });
        const buffer = await blob.arrayBuffer();

        // 用 fflate 解压检查结构
        const entries = unzipSync(new Uint8Array(buffer));
        const entryNames = Object.keys(entries);
        expect(entryNames).toContain("word/document.xml");
        expect(entryNames.some((n) => n.startsWith("word/media/"))).toBe(false); // 未开启图片

        const documentXml = new TextDecoder().decode(entries["word/document.xml"]);
        expect(documentXml).toContain("下列哪个选项是正确的？");
        expect(documentXml).toContain("1+1=____。");
        expect(documentXml).toContain("简述勾股定理。");
        expect(documentXml).toContain("参考答案");
        expect(documentXml).toContain("答案：A");
        expect(documentXml).toContain("解析：这是解析内容。");

        // parseDocx 往返：题干与题数还原，答案回填
        const result = await parseDocx(buffer);
        expect(result.questions).toHaveLength(3);
        expect(result.questions[0].text).toContain("下列哪个选项是正确的？");
        expect(result.questions[1].text).toContain("1+1=____。");
        expect(result.questions[2].text).toContain("简述勾股定理。");
        expect(result.questions[0].answer).toBe("A");
        expect(result.questions[0].analysis).toBe("这是解析内容。");
        expect(result.questions[1].answer).toBe("2");
    }, 20000);

    it("包含原图时 word/media/ 中存在图片文件", async () => {
        const { buildQuestionsDocx } = await import("@/lib/question-format/to-docx");
        const withImage: StructuredQuestion[] = [
            { text: "看图作答。", images: [{ dataUrl: pngDataUrl() }] },
        ];
        const blob = await buildQuestionsDocx(withImage, { includeImages: true });
        const buffer = await blob.arrayBuffer();
        const entries = unzipSync(new Uint8Array(buffer));
        expect(Object.keys(entries).some((n) => n.startsWith("word/media/"))).toBe(true);
    }, 20000);
});
