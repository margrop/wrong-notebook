/**
 * wmf/latex.ts（WMF 结构还原为 LaTeX）的单元测试。
 * 用 WmfBuilder 构造 MathType 风格的 WMF 字节流，验证：
 * - 简单分数（5/9、2/5 等）→ \frac{5}{9}
 * - 两个并列分数
 * - 带分数（2\frac{1}{3}）
 * - 分数前后的普通文字（x=\frac{1}{2}）
 * - 上标（x²）
 * - Symbol 字符映射（×→\times 等）
 * - 多边形 / 斜线 → confidence 'low'
 */
import { describe, expect, it } from "vitest";
import { parseWmf, wmfBytesToLatex, wmfToLatex } from "@/lib/import/file-parsers/docx/wmf";

/** WMF 构造辅助：把记录列表序列化为 placeable WMF 字节（与 wmf-renderer.test.ts 一致） */
class WmfBuilder {
    private words: number[] = [];

    placeableHeader(left: number, top: number, right: number, bottom: number): this {
        this.words.push(0xcdd7, 0x9ac6, 0, left & 0xffff, top & 0xffff, right & 0xffff, bottom & 0xffff, 576, 0, 0, 0);
        return this;
    }

    standardHeader(): this {
        this.words.push(1, 9, 0x0300, 0, 0, 0, 0, 0, 0);
        return this;
    }

    record(func: number, params: number[] = []): this {
        const all = [...params];
        if (all.length % 2 === 1) all.push(0);
        const size = 3 + all.length;
        this.words.push(size, 0, func, ...all);
        return this;
    }

    eof(): this {
        return this.record(0);
    }

    bytes(): Uint8Array {
        const bytes = new Uint8Array(this.words.length * 2);
        const view = new DataView(bytes.buffer);
        for (let i = 0; i < this.words.length; i++) {
            view.setUint16(i * 2, this.words[i], true);
        }
        return bytes;
    }
}

/** 把 ASCII 字符串打包为 16 位小端字数组（每字 2 字符，不足补 NUL） */
function asciiToWords(text: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i));
    if (bytes.length % 2 === 1) bytes.push(0);
    const words: number[] = [];
    for (let i = 0; i < bytes.length; i += 2) {
        words.push(bytes[i] | (bytes[i + 1] << 8));
    }
    return words;
}

/** 生成 CREATEFONTINDIRECT 的 LOGFONT 参数（25 字：9 字字段 + 16 字 faceName） */
function logFontWords(
    height: number,
    weight: number,
    charSet: number,
    faceName: string,
): number[] {
    const words = [height & 0xffff, 0, 0, 0, weight & 0xffff];
    words.push(0, charSet & 0xff << 8, 0, 0);
    const nameBytes: number[] = [];
    for (let i = 0; i < faceName.length && i < 31; i++) nameBytes.push(faceName.charCodeAt(i));
    nameBytes.push(0);
    while (nameBytes.length < 32) nameBytes.push(0);
    for (let i = 0; i < 32; i += 2) {
        words.push(nameBytes[i] | (nameBytes[i + 1] << 8));
    }
    return words;
}

/** 构造一个 MathType 风格的简单分数 WMF（如 5/9、2/5） */
function buildFractionWmf(numerator: string, denominator: string): Uint8Array {
    return new WmfBuilder()
        .standardHeader()
        .record(0x0103, [1])             // SetMapMode(MM_TEXT)
        .record(0x0102, [1])             // SetBkMode(TRANSPARENT)
        .record(0x012e, [0x0019])        // SetTextAlign(TA_UPDATECP | TA_BASELINE | TA_LEFT)
        .record(0x020b, [0, 0])          // SetWindowOrg(y=0, x=0)
        .record(0x020c, [896, 320])      // SetWindowExt(y=896, x=320)
        .record(0x02fb, logFontWords(-400, 400, 0, "Times New Roman"))
        .record(0x012d, [0])             // SelectObject(0) → font
        // 分数线：y=448, x 从 64 到 256
        .record(0x0214, [448, 64])       // MoveTo(y=448, x=64)
        .record(0x0213, [448, 256])      // LineTo(y=448, x=256)
        // 分子
        .record(0x0214, [320, 160])      // MoveTo(y=320, x=160)
        .record(0x0a32, [0, 0, numerator.length, 0, ...asciiToWords(numerator), 100])
        // 分母
        .record(0x0214, [640, 160])      // MoveTo(y=640, x=160)
        .record(0x0a32, [0, 0, denominator.length, 0, ...asciiToWords(denominator), 100])
        .eof()
        .bytes();
}

/** 构造带分数 WMF（如 2\frac{1}{3}）：整数部分在左侧，分数线在右侧 */
function buildMixedNumberWmf(whole: string, numerator: string, denominator: string): Uint8Array {
    return new WmfBuilder()
        .standardHeader()
        .record(0x0103, [1])
        .record(0x0102, [1])
        .record(0x012e, [0x0019])
        .record(0x020b, [0, 0])
        .record(0x020c, [896, 640])      // 更宽：左侧放整数，右侧放分数
        .record(0x02fb, logFontWords(-400, 400, 0, "Times New Roman"))
        .record(0x012d, [0])
        // 整数部分（左侧，基线与分数线对齐）
        .record(0x0214, [448, 80])       // MoveTo(y=448, x=80)
        .record(0x0a32, [0, 0, whole.length, 0, ...asciiToWords(whole), 100])
        // 分数线（右侧）：y=448, x 从 320 到 512
        .record(0x0214, [448, 320])      // MoveTo(y=448, x=320)
        .record(0x0213, [448, 512])      // LineTo(y=448, x=512)
        // 分子
        .record(0x0214, [320, 416])      // MoveTo(y=320, x=416)
        .record(0x0a32, [0, 0, numerator.length, 0, ...asciiToWords(numerator), 100])
        // 分母
        .record(0x0214, [640, 416])      // MoveTo(y=640, x=416)
        .record(0x0a32, [0, 0, denominator.length, 0, ...asciiToWords(denominator), 100])
        .eof()
        .bytes();
}

/** 构造两个并列分数 WMF（如 \frac{1}{2} 和 \frac{3}{4}） */
function buildTwoFractionsWmf(): Uint8Array {
    return new WmfBuilder()
        .standardHeader()
        .record(0x0103, [1])
        .record(0x0102, [1])
        .record(0x012e, [0x0019])
        .record(0x020b, [0, 0])
        .record(0x020c, [896, 640])      // 宽 640
        .record(0x02fb, logFontWords(-400, 400, 0, "Times New Roman"))
        .record(0x012d, [0])
        // 第一个分数线：y=448, x 从 64 到 256
        .record(0x0214, [448, 64])
        .record(0x0213, [448, 256])
        // 第一个分子 "1"
        .record(0x0214, [320, 160])
        .record(0x0a32, [0, 0, 1, 0, 0x0031, 100])
        // 第一个分母 "2"
        .record(0x0214, [640, 160])
        .record(0x0a32, [0, 0, 1, 0, 0x0032, 100])
        // 第二个分数线：y=448, x 从 384 到 576
        .record(0x0214, [448, 384])
        .record(0x0213, [448, 576])
        // 第二个分子 "3"
        .record(0x0214, [320, 480])
        .record(0x0a32, [0, 0, 1, 0, 0x0033, 100])
        // 第二个分母 "4"
        .record(0x0214, [640, 480])
        .record(0x0a32, [0, 0, 1, 0, 0x0034, 100])
        .eof()
        .bytes();
}

/** 构造 x=\frac{1}{2} 风格的 WMF（分数左侧有普通文字） */
function buildXEqualsFractionWmf(): Uint8Array {
    return new WmfBuilder()
        .standardHeader()
        .record(0x0103, [1])
        .record(0x0102, [1])
        .record(0x012e, [0x0019])
        .record(0x020b, [0, 0])
        .record(0x020c, [896, 640])
        .record(0x02fb, logFontWords(-400, 400, 0, "Times New Roman"))
        .record(0x012d, [0])
        // "x="（左侧，基线与分数线对齐）
        .record(0x0214, [448, 40])       // MoveTo(y=448, x=40)
        .record(0x0a32, [0, 0, 2, 0, ...asciiToWords("x="), 100])
        // 分数线（右侧）：y=448, x 从 256 到 448
        .record(0x0214, [448, 256])
        .record(0x0213, [448, 448])
        // 分子 "1"
        .record(0x0214, [320, 352])
        .record(0x0a32, [0, 0, 1, 0, 0x0031, 100])
        // 分母 "2"
        .record(0x0214, [640, 352])
        .record(0x0a32, [0, 0, 1, 0, 0x0032, 100])
        .eof()
        .bytes();
}

/** 构造上标 WMF（如 x²）：大字号的 x 和小字号的 2，2 的基线升高 */
function buildSuperscriptWmf(): Uint8Array {
    return new WmfBuilder()
        .standardHeader()
        .record(0x0103, [1])
        .record(0x0102, [1])
        .record(0x012e, [0x0019])
        .record(0x020b, [0, 0])
        .record(0x020c, [300, 400])
        // 大字体 Times New Roman（槽位 0）
        .record(0x02fb, logFontWords(-200, 400, 0, "Times New Roman"))
        // 小字体 Times New Roman（槽位 1）
        .record(0x02fb, logFontWords(-100, 400, 0, "Times New Roman"))
        // 选大字体，写 "x"
        .record(0x012d, [0])
        .record(0x0214, [240, 40])       // MoveTo(y=240, x=40)
        .record(0x0a32, [0, 0, 1, 0, 0x0078, 100])
        // 选小字体，写 "2"（基线升高：y=180 < 240）
        .record(0x012d, [1])
        .record(0x0214, [180, 140])      // MoveTo(y=180, x=140)
        .record(0x0a32, [0, 0, 1, 0, 0x0032, 100])
        .eof()
        .bytes();
}

/** 构造 Symbol 字体字符 WMF（如 ×、÷、≤、≥、≠、π、°） */
function buildSymbolWmf(): Uint8Array {
    return new WmfBuilder()
        .standardHeader()
        .record(0x0103, [1])
        .record(0x0102, [1])
        .record(0x012e, [0x0019])
        .record(0x020b, [0, 0])
        .record(0x020c, [200, 800])
        .record(0x02fb, logFontWords(-100, 400, 2, "Symbol"))  // charSet=2
        .record(0x012d, [0])
        .record(0x0214, [120, 20])
        // "×÷≤≥≠π°" 的 Symbol 码点：b4 b5 bb bc b8 70 b0
        .record(0x0a32, [0, 0, 7, 0, 0x00b4 | 0x00b5 << 8, 0x00bb | 0x00bc << 8, 0x00b8 | 0x0070 << 8, 0x00b0 | 0x0000 << 8, 50, 50, 50, 50, 50, 50, 50])
        .eof()
        .bytes();
}

/** 构造含多边形的 WMF（应返回 low） */
function buildPolygonWmf(): Uint8Array {
    return new WmfBuilder()
        .standardHeader()
        .record(0x020b, [0, 0])
        .record(0x020c, [200, 200])
        // 三点三角形：count=3, (10,10), (50,10), (30,50)
        .record(0x0324, [3, 10, 10, 50, 10, 30, 50])
        .eof()
        .bytes();
}

/** 构造含斜线的 WMF（应返回 low） */
function buildDiagonalLineWmf(): Uint8Array {
    return new WmfBuilder()
        .standardHeader()
        .record(0x020b, [0, 0])
        .record(0x020c, [200, 200])
        .record(0x0214, [10, 10])        // MoveTo(y=10, x=10)
        .record(0x0213, [100, 100])      // LineTo(y=100, x=100) — 斜线
        .eof()
        .bytes();
}

/** 构造含水平线但无文字的 WMF（分数线但分子/分母不全，应返回 low） */
function buildEmptyFractionWmf(): Uint8Array {
    return new WmfBuilder()
        .standardHeader()
        .record(0x020b, [0, 0])
        .record(0x020c, [200, 200])
        .record(0x0214, [100, 10])
        .record(0x0213, [100, 190])
        .eof()
        .bytes();
}

describe("wmf/latex.ts：简单分数", () => {
    it("5/9 → \\frac{5}{9}，confidence high", () => {
        const result = wmfToLatex(parseWmf(buildFractionWmf("5", "9")));
        expect(result.confidence).toBe("high");
        expect(result.latex).toBe("\\frac{5}{9}");
    });

    it("2/5 → \\frac{2}{5}，confidence high", () => {
        const result = wmfToLatex(parseWmf(buildFractionWmf("2", "5")));
        expect(result.confidence).toBe("high");
        expect(result.latex).toBe("\\frac{2}{5}");
    });

    it("1/3 → \\frac{1}{3}，confidence high", () => {
        const result = wmfToLatex(parseWmf(buildFractionWmf("1", "3")));
        expect(result.confidence).toBe("high");
        expect(result.latex).toBe("\\frac{1}{3}");
    });
});

describe("wmf/latex.ts：并列分数", () => {
    it("两个并列分数 → \\frac{1}{2}\\frac{3}{4}，confidence high", () => {
        const result = wmfToLatex(parseWmf(buildTwoFractionsWmf()));
        expect(result.confidence).toBe("high");
        expect(result.latex).toContain("\\frac{1}{2}");
        expect(result.latex).toContain("\\frac{3}{4}");
    });
});

describe("wmf/latex.ts：带分数", () => {
    it("2\\frac{1}{3} → 2\\frac{1}{3}，confidence high", () => {
        const result = wmfToLatex(parseWmf(buildMixedNumberWmf("2", "1", "3")));
        expect(result.confidence).toBe("high");
        expect(result.latex).toContain("2");
        expect(result.latex).toContain("\\frac{1}{3}");
        // 整数 2 应在分数之前
        expect(result.latex.indexOf("2")).toBeLessThan(result.latex.indexOf("\\frac"));
    });
});

describe("wmf/latex.ts：分数前后文字", () => {
    it("x=\\frac{1}{2} → x=\\frac{1}{2}，confidence high", () => {
        const result = wmfToLatex(parseWmf(buildXEqualsFractionWmf()));
        expect(result.confidence).toBe("high");
        expect(result.latex).toContain("x=");
        expect(result.latex).toContain("\\frac{1}{2}");
        expect(result.latex.indexOf("x=")).toBeLessThan(result.latex.indexOf("\\frac"));
    });
});

describe("wmf/latex.ts：上标", () => {
    it("x² → x^{2}，confidence high", () => {
        const result = wmfToLatex(parseWmf(buildSuperscriptWmf()));
        expect(result.confidence).toBe("high");
        expect(result.latex).toContain("x^{2}");
    });
});

describe("wmf/latex.ts：Symbol 字符映射", () => {
    it("×÷≤≥≠π° 映射为 \\times\\div\\le\\ge\\ne\\pi^\\circ，confidence high", () => {
        const result = wmfToLatex(parseWmf(buildSymbolWmf()));
        expect(result.confidence).toBe("high");
        expect(result.latex).toContain("\\times");
        expect(result.latex).toContain("\\div");
        expect(result.latex).toContain("\\le");
        expect(result.latex).toContain("\\ge");
        expect(result.latex).toContain("\\ne");
        expect(result.latex).toContain("\\pi");
        expect(result.latex).toContain("^\\circ");
    });
});

describe("wmf/latex.ts：复杂图形降级为 low", () => {
    it("含多边形时 confidence low", () => {
        const result = wmfToLatex(parseWmf(buildPolygonWmf()));
        expect(result.confidence).toBe("low");
        expect(result.latex).toBe("");
    });

    it("含斜线时 confidence low", () => {
        const result = wmfToLatex(parseWmf(buildDiagonalLineWmf()));
        expect(result.confidence).toBe("low");
        expect(result.latex).toBe("");
    });

    it("有分数线但无分子/分母文字时 confidence low", () => {
        const result = wmfToLatex(parseWmf(buildEmptyFractionWmf()));
        expect(result.confidence).toBe("low");
    });
});

describe("wmf/latex.ts：便捷入口 wmfBytesToLatex", () => {
    it("有效 WMF 字节返回 high", () => {
        const result = wmfBytesToLatex(buildFractionWmf("5", "9"));
        expect(result.confidence).toBe("high");
        expect(result.latex).toBe("\\frac{5}{9}");
    });

    it("无效字节返回 low 而不抛异常", () => {
        const result = wmfBytesToLatex(new Uint8Array([1, 2, 3]));
        expect(result.confidence).toBe("low");
        expect(result.latex).toBe("");
    });
});

describe("嵌套或叠放的分数按图片保留", () => {
    it("两条分数线在 x 方向重叠且高度不同时返回 low，避免输出错误的 LaTeX", () => {
        const bytes = new WmfBuilder()
            .standardHeader()
            .record(0x0103, [1])
            .record(0x012e, [0x0019])
            .record(0x020b, [0, 0])
            .record(0x020c, [1200, 320])
            .record(0x02fb, logFontWords(-400, 400, 0, "Times New Roman"))
            .record(0x012d, [0])
            // 外层分数线
            .record(0x0214, [448, 32])
            .record(0x0213, [448, 288])
            // 分母中的内层分数线（与外层在 x 方向重叠）
            .record(0x0214, [800, 96])
            .record(0x0213, [800, 224])
            .record(0x0214, [320, 160])
            .record(0x0a32, [0, 0, 1, 0, ...asciiToWords("1"), 100])
            .record(0x0214, [700, 160])
            .record(0x0a32, [0, 0, 1, 0, ...asciiToWords("2"), 100])
            .record(0x0214, [1000, 160])
            .record(0x0a32, [0, 0, 1, 0, ...asciiToWords("3"), 100])
            .eof()
            .bytes();
        expect(wmfBytesToLatex(bytes).confidence).toBe("low");
    });
});
