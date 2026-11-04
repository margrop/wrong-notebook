/**
 * metafile（WMF/EMF）渲染的单元测试。
 * 纯计算部分直接断言；渲染路径注入假渲染器与假光栅化，避免依赖真实 DOM/canvas。
 */
import { describe, expect, it } from "vitest";
import { minimalWmfBytes } from "@/__tests__/helpers/docx-fixture";
import {
    METAFILE_ALT_PREFIX,
    METAFILE_MAX_LONG_EDGE,
    METAFILE_SMALL_HEIGHT,
    computeMetafilePixelSize,
    decodeMetafileAlt,
    decodeMetafileDataUrl,
    encodeMetafileAlt,
    encodeMetafileDataUrl,
    isMetafileDataUrl,
    parseSvgLength,
    ptToPx,
    renderMetafileDataUrl,
    renderMetafileToPng,
} from "@/lib/import/file-parsers/docx/metafile";

describe("computeMetafilePixelSize", () => {
    it("公式小图高度放大到至少 2 倍", () => {
        const { width, height } = computeMetafilePixelSize(60, 30);
        // 30px ≤ 120：放大 ceil(120/30)=4 倍
        expect(height).toBe(120);
        expect(width).toBe(240);
    });

    it("高度极小的图放大到不低于 120px", () => {
        const { height } = computeMetafilePixelSize(4, 12);
        expect(height).toBeGreaterThanOrEqual(METAFILE_SMALL_HEIGHT);
    });

    it("大图不放大，长边超过 1600 时等比缩小", () => {
        const small = computeMetafilePixelSize(800, 600);
        expect(small).toEqual({ width: 800, height: 600 });
        const large = computeMetafilePixelSize(3200, 2400);
        expect(Math.max(large.width, large.height)).toBe(METAFILE_MAX_LONG_EDGE);
        expect(large.width / large.height).toBeCloseTo(3200 / 2400, 1);
    });

    it("高度恰为上限的图不放大", () => {
        // 121 > 120：按公式放大 ceil(120/121)=1 倍，尺寸不变
        const { width, height } = computeMetafilePixelSize(240, 121);
        expect(height).toBe(121);
        expect(width).toBe(240);
    });
});

describe("ptToPx", () => {
    it("72pt = 96px", () => {
        expect(ptToPx(72)).toBe(96);
        expect(ptToPx(50)).toBeCloseTo(66.67, 1);
    });
});

describe("metafile alt 编解码", () => {
    it("encode/decode 往返", () => {
        const alt = encodeMetafileAlt(320, 240);
        expect(alt.startsWith(METAFILE_ALT_PREFIX)).toBe(true);
        expect(decodeMetafileAlt(alt)).toEqual({ width: 320, height: 240 });
    });

    it("非 metafile alt 返回 null", () => {
        expect(decodeMetafileAlt(undefined)).toBeNull();
        expect(decodeMetafileAlt("图片描述")).toBeNull();
    });
});

describe("metafile data URL 编解码", () => {
    it("encode/decode 往返", () => {
        const bytes = new Uint8Array([1, 2, 3, 250, 251]);
        const wmfUrl = encodeMetafileDataUrl(bytes, "wmf");
        expect(isMetafileDataUrl(wmfUrl)).toBe(true);
        const decoded = decodeMetafileDataUrl(wmfUrl);
        expect(decoded?.format).toBe("wmf");
        expect(Array.from(decoded!.bytes)).toEqual([1, 2, 3, 250, 251]);

        const emfUrl = encodeMetafileDataUrl(bytes, "emf");
        expect(isMetafileDataUrl(emfUrl)).toBe(true);
        expect(decodeMetafileDataUrl(emfUrl)?.format).toBe("emf");
    });

    it("普通 png data URL 不识别为 metafile", () => {
        expect(isMetafileDataUrl("data:image/png;base64,AAAA")).toBe(false);
        expect(decodeMetafileDataUrl("data:image/png;base64,AAAA")).toBeNull();
    });
});

describe("parseSvgLength", () => {
    it("解析 px/pt/无单位长度", () => {
        expect(parseSvgLength("320px")).toBe(320);
        expect(parseSvgLength("72pt")).toBe(96);
        expect(parseSvgLength("320")).toBe(320);
    });

    it("非法值返回 null", () => {
        expect(parseSvgLength(null)).toBeNull();
        expect(parseSvgLength("")).toBeNull();
        expect(parseSvgLength("abc")).toBeNull();
        expect(parseSvgLength("-5px")).toBeNull();
    });
});

describe("renderMetafileToPng（注入假渲染器）", () => {
    const fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 75"></svg>';

    it("WMF 渲染成功返回 PNG data URL", async () => {
        const used: string[] = [];
        const renderWmfSvg = (bytes: ArrayBuffer) => {
            used.push(`wmf:${bytes.byteLength}`);
            return fakeSvg;
        };
        const rasterize = async () => "data:image/png;base64,AAAA";
        const png = await renderMetafileToPng(new ArrayBuffer(4), "wmf", { width: 100, height: 50 }, { renderWmfSvg, rasterize });
        expect(png).toBe("data:image/png;base64,AAAA");
        expect(used).toEqual(["wmf:4"]);
    });

    it("EMF 暂不渲染，直接返回 null", async () => {
        const renderWmfSvg = () => fakeSvg;
        const rasterize = async () => "data:image/png;base64,AAAA";
        const png = await renderMetafileToPng(new ArrayBuffer(4), "emf", { width: 100, height: 50 }, { renderWmfSvg, rasterize });
        expect(png).toBeNull();
    });

    it("渲染器返回 null 时整体返回 null", async () => {
        const renderWmfSvg = () => null;
        const rasterize = async () => "data:image/png;base64,AAAA";
        const png = await renderMetafileToPng(new ArrayBuffer(4), "wmf", { width: 100, height: 50 }, { renderWmfSvg, rasterize });
        expect(png).toBeNull();
    });

    it("渲染器抛错返回 null", async () => {
        const renderWmfSvg = () => { throw new Error("bad wmf"); };
        const rasterize = async () => "data:image/png;base64,AAAA";
        const png = await renderMetafileToPng(new ArrayBuffer(4), "wmf", { width: 100, height: 50 }, { renderWmfSvg, rasterize });
        expect(png).toBeNull();
    });

    it("光栅化失败返回 null", async () => {
        const renderWmfSvg = () => fakeSvg;
        const rasterize = async () => null;
        const png = await renderMetafileToPng(new ArrayBuffer(4), "wmf", { width: 100, height: 50 }, { renderWmfSvg, rasterize });
        expect(png).toBeNull();
    });

    it("renderMetafileDataUrl 解码失败返回 null", async () => {
        const renderWmfSvg = () => fakeSvg;
        const rasterize = async () => "data:image/png;base64,AAAA";
        const png = await renderMetafileDataUrl("data:image/png;base64,AAAA", { width: 100, height: 50 }, { renderWmfSvg, rasterize });
        expect(png).toBeNull();
    });

    it("默认渲染器能解析最小 WMF 字节产出 SVG", async () => {
        // 走默认 renderWmfSvg 路径（不注入），仅验证不抛错且产出非空字符串
        const bytes = minimalWmfBytes();
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        // 使用注入的 rasterize 捕获 SVG 元素
        let capturedSvg: SVGElement | null = null;
        const rasterize = async (svg: SVGElement) => {
            capturedSvg = svg;
            return "data:image/png;base64,AAAA";
        };
        const png = await renderMetafileToPng(buffer, "wmf", { width: 400, height: 300 }, { rasterize });
        expect(png).toBe("data:image/png;base64,AAAA");
        expect(capturedSvg).not.toBeNull();
    });
});
