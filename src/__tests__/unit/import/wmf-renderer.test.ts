/**
 * 自研 WMF 渲染器（src/lib/import/file-parsers/docx/wmf/）的单元测试。
 * 用代码构造 WMF 字节（placeable 头 + 记录列表），验证：
 * - TA_UPDATECP 下的 ExtTextOut 文字定位（rtf.js 的 bug 场景）；
 * - 带 dx 数组的逐字定位；
 * - 分数线（MoveTo/LineTo）；
 * - 字体切换与 Symbol 字符映射；
 * - Polygon、Save/RestoreDC、对象表槽位复用。
 */
import { describe, expect, it } from "vitest";
import { parseWmf, renderWmfSvg, wmfBytesToSvg } from "@/lib/import/file-parsers/docx/wmf";

/** WMF 构造辅助：把记录列表序列化为 placeable WMF 字节 */
class WmfBuilder {
    private words: number[] = [];

    /** 写 placeable 头：key + hmf=0 + bbox + inch=576 + reserved=0 + checksum=0 */
    placeableHeader(left: number, top: number, right: number, bottom: number): this {
        // key 0x9AC6CDD7（小端 2 字）
        this.words.push(0xcdd7, 0x9ac6);
        // hmf = 0
        this.words.push(0);
        // bbox：left, top, right, bottom（各有符号 16 位）
        this.words.push(left & 0xffff, top & 0xffff, right & 0xffff, bottom & 0xffff);
        // inch = 576
        this.words.push(576);
        // reserved = 0（2 字）
        this.words.push(0, 0);
        // checksum = 0
        this.words.push(0);
        return this;
    }

    /** 写标准 metafile 头（9 字） */
    standardHeader(): this {
        this.words.push(
            1,      // type = 1（显式内存 metafile）
            9,      // headerSize = 9 字
            0x0300, // version = 0x0300
            0, 0,   // size（2 字，占位）
            0,      // objects（占位）
            0, 0,   // maxRecord（2 字，占位）
            0,      // numOfParams
        );
        return this;
    }

    /**
     * 写一条记录：size（DWORD，含自身与 func，占 2 字）+ func + params。
     * 若 params 为奇数个字，自动补一个 0。
     */
    record(func: number, params: number[] = []): this {
        const all = [...params];
        if (all.length % 2 === 1) all.push(0);
        // size = 2(size 本身，DWORD) + 1(func) + all.length（params 字数）
        const size = 3 + all.length;
        // size 是 DWORD：低字在前，高字为 0
        this.words.push(size, 0, func, ...all);
        return this;
    }

    /** META_EOF */
    eof(): this {
        return this.record(0);
    }

    /** 输出字节 */
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
    opts: { italic?: boolean; underline?: boolean; strikeOut?: boolean } = {},
): number[] {
    // 前 5 个 16 位字段：height, width=0, escapement=0, orientation=0, weight
    const words = [height & 0xffff, 0, 0, 0, weight & 0xffff];
    // 4 个「2×uint8」字段：italic|underline<<8, strikeOut|charSet<<8, outPrec|clipPrec<<8, quality|pitchFam<<8
    words.push(
        (opts.italic ? 1 : 0) | ((opts.underline ? 1 : 0) << 8),
        (opts.strikeOut ? 1 : 0) | ((charSet & 0xff) << 8),
        0,
        0,
    );
    // lfFaceName：32 字节，NUL 结尾
    const nameBytes: number[] = [];
    for (let i = 0; i < faceName.length && i < 31; i++) nameBytes.push(faceName.charCodeAt(i));
    nameBytes.push(0);
    while (nameBytes.length < 32) nameBytes.push(0);
    for (let i = 0; i < 32; i += 2) {
        words.push(nameBytes[i] | (nameBytes[i + 1] << 8));
    }
    return words;
}

// ─── 用例 1：TA_UPDATECP 下的 ExtTextOut ─────────────────────────────────────

describe("TA_UPDATECP 下的 ExtTextOut", () => {
    it("ExtTextOut 文字以 currentX/currentY 为起点，结束后 currentX 前移", () => {
        const wmf = new WmfBuilder()
            .placeableHeader(0, 0, 400, 300)
            .standardHeader()
            .record(0x020b, [0, 0])          // SetWindowOrg(y=0, x=0)
            .record(0x020c, [300, 400])      // SetWindowExt(y=300, x=400)
            // SetTextAlign(TA_UPDATECP | TA_BASELINE | TA_LEFT) = 0x0019
            .record(0x012e, [0x0019])
            .record(0x0214, [80, 50])        // MoveTo(y=80, x=50)
            // CreateFontIndirect：height=-20, width=0, escapement=0, orientation=0,
            // weight=400, italic=0, underline=0, strikeOut=0, charSet=0, ...
            .record(0x02fb, logFontWords(-20, 400, 0, "Arial"))
            .record(0x012d, [0])             // SelectObject(0)
            // ExtTextOut(y=100, x=0, count=3, options=0, "abc")
            // 参数序：y, x, count, options（无 RECT），然后是文字
            .record(0x0a32, [100, 0, 3, 0, ...asciiToWords("abc")])
            .eof();

        const parsed = parseWmf(wmf.bytes());
        expect(parsed.texts).toHaveLength(1);
        const text = parsed.texts[0];
        // TA_UPDATECP：x=0 时以 currentX=50 为起点；TA_BASELINE：y=100 不变
        expect(text.x).toBe(50);
        expect(text.text).toBe("abc");
        // usedUpdateCp 标志应被记录
        expect(parsed.usedUpdateCp).toBe(true);
    });

    it("TA_UPDATECP 下连续两个 ExtTextOut 第二个紧跟第一个之后", () => {
        const wmf = new WmfBuilder()
            .placeableHeader(0, 0, 400, 300)
            .standardHeader()
            .record(0x020b, [0, 0])
            .record(0x020c, [300, 400])
            // CreateFontIndirect：height=-20, charSet=0, "Arial"
            .record(0x02fb, logFontWords(-20, 400, 0, "Arial"))
            .record(0x012d, [0])             // SelectObject(font)
            // SetTextAlign(TA_UPDATECP | TA_TOP | TA_LEFT) = 0x0001
            .record(0x012e, [0x0001])
            .record(0x0214, [20, 10])        // MoveTo(y=20, x=10)
            // ExtTextOut(y=20, x=0, count=1, options=0, "5", dx=[10])
            // params: y, x, count, options, text(packed+pad), dx...
            .record(0x0a32, [20, 0, 1, 0, 0x0035, 10])
            // ExtTextOut(y=20, x=0, count=1, options=0, "9", dx=[10])
            .record(0x0a32, [20, 0, 1, 0, 0x0039, 10])
            .eof();

        const parsed = parseWmf(wmf.bytes());
        expect(parsed.texts).toHaveLength(2);
        // 第一个文字 x = 10（MoveTo 的 x）
        expect(parsed.texts[0].x).toBe(10);
        expect(parsed.texts[0].text).toBe("5");
        // 第二个文字 x = 10 + 估算宽度（|−20| × 0.5 = 10）
        expect(parsed.texts[1].x).toBe(20);
        expect(parsed.texts[1].text).toBe("9");
    });
});

// ─── 用例 2：带 dx 数组的逐字定位 ────────────────────────────────────────────

describe("带 dx 数组的 ExtTextOut 逐字定位", () => {
    it("dx 数组让每个字符按指定偏移定位", () => {
        const wmf = new WmfBuilder()
            .placeableHeader(0, 0, 400, 300)
            .standardHeader()
            .record(0x020b, [0, 0])
            .record(0x020c, [300, 400])
            .record(0x02fb, logFontWords(-20, 400, 0, "Arial"))
            .record(0x012d, [0])
            // SetTextAlign(TA_TOP | TA_LEFT) = 0x0000（无 UPDATECP）
            .record(0x012e, [0x0000])
            // ExtTextOut(y=50, x=30, count=3, options=0, "abc", dx=[5,7,6])
            // 参数序：y, x, count, options（无 RECT），文字（按字对齐），dx 数组
            .record(0x0a32, [
                50, 30, 3, 0,
                ...asciiToWords("abc"),  // 3 字，奇数 → 补 1 字
                5, 7, 6,
            ])
            .eof();

        const parsed = parseWmf(wmf.bytes());
        expect(parsed.texts).toHaveLength(3);
        expect(parsed.texts[0].text).toBe("a");
        expect(parsed.texts[0].x).toBe(30);
        expect(parsed.texts[1].text).toBe("b");
        expect(parsed.texts[1].x).toBe(35);
        expect(parsed.texts[2].text).toBe("c");
        expect(parsed.texts[2].x).toBe(42);
    });
});

// ─── 用例 3：分数线（MoveTo/LineTo）──────────────────────────────────────────

describe("分数线（MoveTo/LineTo）", () => {
    it("MoveTo + LineTo 生成水平折线，SVG 含 polyline 元素", () => {
        const wmf = new WmfBuilder()
            .placeableHeader(0, 0, 200, 100)
            .standardHeader()
            .record(0x020b, [0, 0])
            .record(0x020c, [100, 200])
            .record(0x0214, [50, 10])        // MoveTo(y=50, x=10)
            .record(0x0213, [50, 100])       // LineTo(y=50, x=100)
            .eof();

        const parsed = parseWmf(wmf.bytes());
        expect(parsed.polylines).toHaveLength(1);
        expect(parsed.polylines[0].points).toEqual([
            { x: 10, y: 50 },
            { x: 100, y: 50 },
        ]);

        const svg = renderWmfSvg(parsed);
        expect(svg).toContain("<polyline");
        expect(svg).toContain('points="10,50 100,50"');
    });
});

// ─── 用例 4：字体切换与 Symbol 字符映射 ─────────────────────────────────────

describe("字体切换与 Symbol 字符映射", () => {
    it("Symbol 字体的希腊字母按码点映射为 Unicode", () => {
        // 构造 Symbol 字体记录：charSet=2(0x0002)，faceName="Symbol"
        const wmf = new WmfBuilder()
            .placeableHeader(0, 0, 400, 300)
            .standardHeader()
            .record(0x020b, [0, 0])
            .record(0x020c, [300, 400])
            .record(0x02fb, logFontWords(-20, 400, 2, "Symbol"))
            .record(0x012d, [0])
            .record(0x012e, [0x0000])        // TA_TOP | TA_LEFT
            // ExtTextOut(y=50, x=30, count=2, options=0, "ab")
            // Symbol 字体中 a→α, b→β
            .record(0x0a32, [50, 30, 2, 0, ...asciiToWords("ab")])
            .eof();

        const parsed = parseWmf(wmf.bytes());
        expect(parsed.texts).toHaveLength(1);
        expect(parsed.texts[0].font?.charSet).toBe(2);

        const svg = renderWmfSvg(parsed);
        expect(svg).toContain("α");
        expect(svg).toContain("β");
        expect(svg).not.toContain(">ab<");
    });

    it("非 Symbol 字体的 ASCII 字符按原样输出", () => {
        const wmf = new WmfBuilder()
            .placeableHeader(0, 0, 400, 300)
            .standardHeader()
            .record(0x020b, [0, 0])
            .record(0x020c, [300, 400])
            .record(0x02fb, logFontWords(-20, 400, 0, "Arial"))
            .record(0x012d, [0])
            .record(0x012e, [0x0000])
            .record(0x0a32, [50, 30, 3, 0, ...asciiToWords("abc")])
            .eof();

        const svg = wmfBytesToSvg(wmf.bytes());
        expect(svg).toContain("abc");
    });
});

// ─── 用例 5：Polygon ─────────────────────────────────────────────────────────

describe("Polygon", () => {
    it("Polygon 记录生成 SVG polygon 元素", () => {
        const wmf = new WmfBuilder()
            .placeableHeader(0, 0, 200, 200)
            .standardHeader()
            .record(0x020b, [0, 0])
            .record(0x020c, [200, 200])
            // 三点三角形：count=3, (10,10), (50,10), (30,50)
            .record(0x0324, [3, 10, 10, 50, 10, 30, 50])
            .eof();

        const parsed = parseWmf(wmf.bytes());
        expect(parsed.polygons).toHaveLength(1);
        expect(parsed.polygons[0].points).toEqual([
            { x: 10, y: 10 },
            { x: 50, y: 10 },
            { x: 30, y: 50 },
        ]);

        const svg = renderWmfSvg(parsed);
        expect(svg).toContain("<polygon");
        expect(svg).toContain('points="10,10 50,10 30,50"');
    });
});

// ─── 用例 6：SaveDC/RestoreDC ────────────────────────────────────────────────

describe("SaveDC/RestoreDC", () => {
    it("RestoreDC 恢复之前的 textAlign 和 textColor", () => {
        const wmf = new WmfBuilder()
            .placeableHeader(0, 0, 400, 300)
            .standardHeader()
            .record(0x020b, [0, 0])
            .record(0x020c, [300, 400])
            .record(0x02fb, logFontWords(-20, 400, 0, "Arial"))
            .record(0x012d, [0])
            // SetTextAlign(TA_TOP | TA_LEFT) = 0x0000
            .record(0x012e, [0x0000])
            // SetTextColor 红色 = COLORREF 0x000000FF（小端字 [0x00FF, 0x0000]）
            .record(0x0209, [0x00ff, 0x0000])
            .record(0x001e)                     // SaveDC
            // 修改状态：SetTextAlign(TA_UPDATECP) + SetTextColor 蓝色
            .record(0x012e, [0x0001])
            .record(0x0209, [0x0000, 0x00ff])  // 蓝色 = COLORREF 0x00FF0000
            .record(0x0127, [0xffff])           // RestoreDC(-1)
            // 此时 textAlign 应为 TA_TOP|TA_LEFT，颜色应为红色
            .record(0x0a32, [50, 30, 1, 0, ...asciiToWords("a")])
            .eof();

        const parsed = parseWmf(wmf.bytes());
        expect(parsed.texts).toHaveLength(1);
        // RestoreDC 后颜色应为 SaveDC 时的红色（BGR 0x0000FF = 红色）
        expect(parsed.texts[0].color).toBe(0x0000ff);
        // align 应为 SaveDC 时的 0x0000（TA_TOP | TA_LEFT）
        expect(parsed.texts[0].align).toBe(0x0000);
    });
});

// ─── 用例 7：对象表槽位复用 ─────────────────────────────────────────────────

describe("对象表槽位复用", () => {
    it("DeleteObject 后槽位可被新对象复用，SelectObject 指向正确对象", () => {
        const fontArial = logFontWords(-20, 400, 0, "Arial");
        const fontTimes = logFontWords(-20, 400, 0, "Times");

        const wmf = new WmfBuilder()
            .placeableHeader(0, 0, 400, 300)
            .standardHeader()
            .record(0x020b, [0, 0])
            .record(0x020c, [300, 400])
            // 槽位 0：Arial
            .record(0x02fb, fontArial)
            // 槽位 1：Times
            .record(0x02fb, fontTimes)
            .record(0x012d, [0])             // SelectObject(0) → Arial
            .record(0x012e, [0x0000])
            .record(0x0a32, [50, 30, 1, 0, ...asciiToWords("a")])
            // 删除槽位 0（Arial）
            .record(0x01f0, [0])
            // 槽位 0 现在应被新字体（Courier）复用
            .record(0x02fb, logFontWords(-20, 400, 0, "Courier"))
            .record(0x012d, [0])             // SelectObject(0) → Courier
            .record(0x0a32, [100, 30, 1, 0, ...asciiToWords("b")])
            .eof();

        const parsed = parseWmf(wmf.bytes());
        expect(parsed.texts).toHaveLength(2);
        expect(parsed.texts[0].font?.faceName).toBe("Arial");
        expect(parsed.texts[1].font?.faceName).toBe("Courier");
    });
});

// ─── 附加：Rectangle 记录 ────────────────────────────────────────────────────

describe("Rectangle", () => {
    it("Rectangle 记录生成四点多边形", () => {
        const wmf = new WmfBuilder()
            .placeableHeader(0, 0, 200, 200)
            .standardHeader()
            .record(0x020b, [0, 0])
            .record(0x020c, [200, 200])
            // Rectangle(bottom=80, right=100, top=20, left=10)
            .record(0x041b, [80, 100, 20, 10])
            .eof();

        const parsed = parseWmf(wmf.bytes());
        expect(parsed.polygons).toHaveLength(1);
        expect(parsed.polygons[0].points).toEqual([
            { x: 10, y: 20 },
            { x: 100, y: 20 },
            { x: 100, y: 80 },
            { x: 10, y: 80 },
        ]);
    });
});

// ─── 附加：SVG viewBox 与无 placeable 头的 WMF ───────────────────────────────

describe("SVG viewBox", () => {
    it("placeable 头 bbox 作为 viewBox", () => {
        const wmf = new WmfBuilder()
            .placeableHeader(0, 0, 400, 300)
            .standardHeader()
            .record(0x020b, [0, 0])
            .record(0x020c, [300, 400])
            .record(0x0214, [10, 10])
            .record(0x0213, [100, 100])
            .eof();

        const svg = wmfBytesToSvg(wmf.bytes());
        expect(svg).toContain('viewBox="0 0 400 300"');
    });

    it("无 placeable 头时用 SetWindowOrg/SetWindowExt 作为 viewBox（y,x 顺序）", () => {
        const wmf = new WmfBuilder()
            .standardHeader()
            .record(0x020b, [0, 0])
            .record(0x020c, [150, 200])  // y=150, x=200 → viewBox 宽 200 高 150
            .record(0x0214, [10, 10])
            .record(0x0213, [100, 100])
            .eof();

        const svg = wmfBytesToSvg(wmf.bytes());
        expect(svg).toContain('viewBox="0 0 200 150"');
    });

    it("SetWindowExt 高大于宽时 viewBox 也是高大于宽（瘦高图）", () => {
        const wmf = new WmfBuilder()
            .standardHeader()
            .record(0x020b, [0, 0])
            .record(0x020c, [896, 320])  // y=896, x=320 → viewBox 宽 320 高 896
            .eof();

        const svg = wmfBytesToSvg(wmf.bytes());
        expect(svg).toContain('viewBox="0 0 320 896"');
    });
});

// ─── MathType 风格分数 WMF 端到端测试 ────────────────────────────────────────

describe("MathType 风格分数 WMF", () => {
    /**
     * 构造与 MathType 一致的分数 WMF：
     * - SetWindowExt 高大于宽（瘦高图）；
     * - 横向分数线（MoveTo+LineTo 两端 y 相同）；
     * - 分子在上（y 较小）、分母在下（y 较大）。
     */
    function buildFractionWmf(): Uint8Array {
        return new WmfBuilder()
            .standardHeader()
            .record(0x0103, [1])             // SetMapMode(MM_TEXT)
            .record(0x0102, [1])             // SetBkMode(TRANSPARENT)
            // SetTextAlign(TA_UPDATECP | TA_BASELINE | TA_LEFT) = 0x0019
            .record(0x012e, [0x0019])
            .record(0x020b, [0, 0])          // SetWindowOrg(y=0, x=0)
            .record(0x020c, [896, 320])      // SetWindowExt(y=896, x=320)
            // 创建 Times New Roman 字体（槽位 0，无 pen/brush 占用）
            .record(0x02fb, logFontWords(-400, 400, 0, "Times New Roman"))
            .record(0x012d, [0])             // SelectObject(0) → font
            // 画横向分数线：y=448, x 从 64 到 256
            .record(0x0214, [448, 64])       // MoveTo(y=448, x=64)
            .record(0x0213, [448, 256])      // LineTo(y=448, x=256)
            // 分子 "5"：MoveTo(y=320, x=160)，TA_UPDATECP 定位
            .record(0x0214, [320, 160])      // MoveTo(y=320, x=160)
            .record(0x0a32, [0, 0, 1, 0, 0x0035, 100])  // ExtTextOut(y=0,x=0, "5", dx=[100])
            // 分母 "9"：MoveTo(y=640, x=160)，TA_UPDATECP 定位
            .record(0x0214, [640, 160])      // MoveTo(y=640, x=160)
            .record(0x0a32, [0, 0, 1, 0, 0x0039, 100])  // ExtTextOut(y=0,x=0, "9", dx=[100])
            .eof()
            .bytes();
    }

    it("viewBox 高大于宽，分数线水平，分子在上分母在下", () => {
        const parsed = parseWmf(buildFractionWmf());

        // viewBox：SetWindowExt(y=896, x=320) → 宽 320、高 896
        expect(parsed.viewBox.width).toBe(320);
        expect(parsed.viewBox.height).toBe(896);

        // 分数线：水平线（两端 y 相同）
        expect(parsed.polylines).toHaveLength(1);
        const line = parsed.polylines[0];
        expect(line.points[0].y).toBe(line.points[1].y);
        expect(line.points[0].x).toBe(64);
        expect(line.points[1].x).toBe(256);

        // 分子 "5" yTop 应小于分母 "9" yTop（分子在上）
        expect(parsed.texts).toHaveLength(2);
        const numerator = parsed.texts.find((t) => t.text === "5");
        const denominator = parsed.texts.find((t) => t.text === "9");
        expect(numerator).toBeDefined();
        expect(denominator).toBeDefined();
        expect(numerator!.y).toBeLessThan(denominator!.y);
        // 分子基线（yTop + 0.8×fontSize）应小于分数线 y；分母基线应大于分数线 y
        const fontSize = 400;
        const numeratorBaseline = numerator!.y + Math.round(fontSize * 0.8);
        const denominatorBaseline = denominator!.y + Math.round(fontSize * 0.8);
        expect(numeratorBaseline).toBeLessThan(448);
        expect(denominatorBaseline).toBeGreaterThan(448);
    });

    it("SVG 可被 DOMParser 无错误解析（image/svg+xml）", () => {
        const svg = wmfBytesToSvg(buildFractionWmf());
        const parser = new DOMParser();
        const doc = parser.parseFromString(svg, "image/svg+xml");
        // 检查是否有解析错误（jsdom 中 parsererror 标签的命名空间可能不同，用 getElementsByTagName 兜底）
        const errors = doc.getElementsByTagName("parsererror");
        expect(errors.length).toBe(0);
        // 根元素是 svg
        expect(doc.documentElement.tagName.toLowerCase()).toBe("svg");
        // font-family 属性值中的字体名用单引号包裹
        expect(svg).toContain("font-family=\"'Times New Roman', 'Nimbus Roman', serif\"");
    });

    it("SVG font-family 无未转义双引号", () => {
        const svg = wmfBytesToSvg(buildFractionWmf());
        // font-family 属性值不应含未转义的双引号
        const fontFamilyMatch = /font-family="([^"]*)"/.exec(svg);
        expect(fontFamilyMatch).not.toBeNull();
        const value = fontFamilyMatch![1];
        expect(value).not.toContain('"');
    });
});
