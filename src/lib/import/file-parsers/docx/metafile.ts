/**
 * Word（.docx）中 WMF/EMF 图片（MathType/公式编辑器 OLE 对象的预览图等）的浏览器端渲染。
 *
 * - WMF 用自研轻量渲染器（src/lib/import/file-parsers/docx/wmf/）解析并输出 SVG，
 *   支持 MathType 的 TA_UPDATECP 文字定位与 dx 数组逐字定位（rtf.js 不支持，文字全堆在 (0,0)）；
 * - EMF 暂不渲染（MathType 公式预览图基本为 WMF），计入 METAFILE_FAILED 警告；
 * - 这里用 Image + canvas 把 SVG 光栅化为白底 PNG data URL，供题目原图合成；
 * - 纯计算（目标尺寸、像素换算）与 DOM/canvas 部分分离，测试可注入假渲染器；
 * - 待渲染图片以 data:image/wmf;base64,… / data:image/emf;base64,… 挂在题目 images 上，
 *   显示尺寸（渲染目标像素）通过 alt 的结构化前缀传递（见 METAFILE_ALT_PREFIX）。
 *
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */

import { wmfBytesToSvg } from "./wmf";

/** 光栅化输出的最长边（像素），与题目原图合成上限一致 */
export const METAFILE_MAX_LONG_EDGE = 1600;
/** 输出 PNG data URL 的最大长度（base64 字符数，约 5MB 字节），超出视为渲染失败 */
export const METAFILE_MAX_DATA_URL_LENGTH = 5 * 1024 * 1024;
/** 显示高度不超过该值（渲染目标像素）的图片视为公式小图，高度至少放大到 METAFILE_SMALL_SCALE 倍 */
export const METAFILE_SMALL_HEIGHT = 120;
/** 公式小图的放大倍数下限 */
export const METAFILE_SMALL_SCALE = 2;
/** 一题内参与合成的 metafile 图片最多张数，超出部分不再拼接（计入 METAFILE_TRUNCATED 警告） */
export const METAFILE_MAX_PER_QUESTION = 12;
/** 无显示尺寸信息时的默认渲染目标（像素） */
export const METAFILE_FALLBACK_WIDTH = 800;
export const METAFILE_FALLBACK_HEIGHT = 600;

/** alt 结构化前缀：待渲染 metafile 图片的 alt 形如 "metafile;800x600"（宽×高为渲染目标像素） */
export const METAFILE_ALT_PREFIX = "metafile;";

/**
 * 把 WMF 字节渲染为 SVG 字符串；解析失败返回 null。
 * 抽出独立函数便于测试注入与错误边界控制。
 */
function renderWmfToSvg(bytes: ArrayBuffer): string | null {
    try {
        const uint8 = new Uint8Array(bytes);
        return wmfBytesToSvg(uint8);
    } catch {
        return null;
    }
}

/** 把 SVG 字符串解析为 DOM 元素（jsdom/浏览器环境） */
function svgTextToElement(svgText: string): SVGElement {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const svg = doc.documentElement;
    // jsdom 中 SVG 命名空间的元素可能不是 SVGElement 实例，用 tagName 兜底判断
    if (!svg || svg.tagName.toLowerCase() !== "svg" || !svg.getAttribute("viewBox")) {
        throw new Error("METAFILE_SVG_PARSE_FAILED");
    }
    return svg as unknown as SVGElement;
}

/** 目标输出尺寸（纯计算） */
export interface MetafileTargetSize {
    width: number;
    height: number;
}

/** 编码待渲染 metafile 图片的 alt：携带渲染目标像素尺寸 */
export function encodeMetafileAlt(width: number, height: number): string {
    return `${METAFILE_ALT_PREFIX}${Math.max(1, Math.round(width))}x${Math.max(1, Math.round(height))}`;
}

/** 解析待渲染 metafile 图片的 alt；不是 metafile 标记时返回 null */
export function decodeMetafileAlt(alt: string | undefined): MetafileTargetSize | null {
    if (!alt || !alt.startsWith(METAFILE_ALT_PREFIX)) return null;
    const match = /^(\d+)x(\d+)$/.exec(alt.slice(METAFILE_ALT_PREFIX.length));
    if (!match) return null;
    return { width: Number.parseInt(match[1], 10), height: Number.parseInt(match[2], 10) };
}

/** 判断 data URL 是否是待渲染的 metafile 图片 */
export function isMetafileDataUrl(dataUrl: string): boolean {
    return dataUrl.startsWith("data:image/wmf;base64,") || dataUrl.startsWith("data:image/emf;base64,");
}

/** 解码 metafile data URL 为原始字节与格式（纯计算） */
export function decodeMetafileDataUrl(dataUrl: string): { bytes: Uint8Array; format: "wmf" | "emf" } | null {
    const prefix = dataUrl.startsWith("data:image/wmf;base64,")
        ? "data:image/wmf;base64,"
        : dataUrl.startsWith("data:image/emf;base64,")
            ? "data:image/emf;base64,"
            : null;
    if (!prefix) return null;
    const format = prefix.includes("/wmf") ? "wmf" : "emf";
    try {
        const base64 = dataUrl.slice(prefix.length);
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return { bytes, format };
    } catch {
        return null;
    }
}

/** 把原始字节编码为待渲染的 metafile data URL（解析阶段挂到题目 images 上） */
export function encodeMetafileDataUrl(bytes: Uint8Array, format: "wmf" | "emf"): string {
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode(...chunk);
    }
    return `data:image/${format};base64,${btoa(binary)}`;
}

/**
 * 计算 metafile 光栅化的最终渲染目标（纯计算）。
 * displayWidth/displayHeight 是图片在 Word 中的显示尺寸换算出的像素（pt × 96/72 或 EMU 换算）。
 * 公式小图（显示高度 ≤ METAFILE_SMALL_HEIGHT）放大到至少 METAFILE_SMALL_SCALE 倍，
 * 保证小公式清晰；长边不超过 METAFILE_MAX_LONG_EDGE。
 */
export function computeMetafilePixelSize(
    displayWidth: number,
    displayHeight: number,
): MetafileTargetSize {
    let width = Math.max(1, Math.round(displayWidth));
    let height = Math.max(1, Math.round(displayHeight));
    if (height <= METAFILE_SMALL_HEIGHT && height > 0) {
        const scale = Math.max(METAFILE_SMALL_SCALE, Math.ceil(METAFILE_SMALL_HEIGHT / height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
    }
    const longEdge = Math.max(width, height);
    if (longEdge > METAFILE_MAX_LONG_EDGE) {
        const factor = METAFILE_MAX_LONG_EDGE / longEdge;
        width = Math.max(1, Math.round(width * factor));
        height = Math.max(1, Math.round(height * factor));
    }
    return { width, height };
}

/** 可注入的依赖集合（测试中替换为假实现，jsdom 中无需真实 DOM/canvas） */
export interface RenderMetafileDeps {
    /** 把 WMF 字节渲染为 SVG 字符串；返回 null 表示失败（测试中注入假实现） */
    renderWmfSvg?: (bytes: ArrayBuffer) => string | null;
    /** 把渲染出的 SVG 光栅化为 PNG data URL；返回 null 表示失败 */
    rasterize?: (svg: SVGElement) => Promise<string | null>;
}

/** pt → px（96dpi，纯计算） */
export function ptToPx(pt: number): number {
    return (pt * 96) / 72;
}

/** 浏览器端默认光栅化：SVG → Image → canvas → 白底 PNG data URL；任何一步失败返回 null */
async function defaultRasterize(svg: SVGElement): Promise<string | null> {
    try {
        const serializer = new XMLSerializer();
        const svgText = serializer.serializeToString(svg);
        const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
        const image = await loadImage(svgUrl);
        try {
            const width = Math.max(1, Math.round(image.naturalWidth || parseSvgLength(svg.getAttribute("width")) || 1));
            const height = Math.max(1, Math.round(image.naturalHeight || parseSvgLength(svg.getAttribute("height")) || 1));
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(image, 0, 0, width, height);
            const dataUrl = canvas.toDataURL("image/png");
            return dataUrl.length <= METAFILE_MAX_DATA_URL_LENGTH ? dataUrl : null;
        } finally {
            image.remove();
        }
    } catch {
        return null;
    }
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("METAFILE_IMAGE_LOAD_FAILED"));
        image.src = url;
    });
}

/** 解析 "123px"/"123pt"/"123" 之类的 SVG 长度字符串为像素（纯计算，失败返回 null） */
export function parseSvgLength(value: string | null): number | null {
    if (!value) return null;
    const match = /^(-?\d+(?:\.\d+)?)(px|pt)?$/.exec(value.trim());
    if (!match) return null;
    const num = Number.parseFloat(match[1]);
    if (!Number.isFinite(num) || num <= 0) return null;
    if (match[2] === "pt") return (num * 96) / 72;
    return num;
}

/**
 * 把 WMF/EMF 字节渲染为 PNG data URL。
 * WMF 用自研渲染器解析为 SVG 后光栅化；EMF 暂不渲染（MathType 公式基本都是 WMF），直接返回 null，
 * 由调用方计入 METAFILE_FAILED 警告。
 * 渲染失败（格式不识别、解析失败、光栅化失败、输出超限）返回 null。
 */
export async function renderMetafileToPng(
    bytes: ArrayBuffer,
    format: "wmf" | "emf",
    target: MetafileTargetSize,
    deps: RenderMetafileDeps = {},
): Promise<string | null> {
    void target; // target 保留在签名中，兼容既有调用与测试注入；SVG viewBox 本身携带尺寸
    if (format === "emf") return null;
    const renderSvg = deps.renderWmfSvg ?? renderWmfToSvg;
    const rasterize = deps.rasterize ?? defaultRasterize;
    try {
        const svgText = renderSvg(bytes);
        if (svgText === null) return null;
        const svg = svgTextToElement(svgText);
        return await rasterize(svg);
    } catch {
        return null;
    }
}

/**
 * 把待渲染的 metafile data URL 渲染为 PNG data URL；失败返回 null。
 * dataUrl 需为 data:image/wmf;base64,… 或 data:image/emf;base64,…。
 */
export async function renderMetafileDataUrl(
    dataUrl: string,
    target: MetafileTargetSize,
    deps: RenderMetafileDeps = {},
): Promise<string | null> {
    const decoded = decodeMetafileDataUrl(dataUrl);
    if (!decoded) return null;
    const buffer = decoded.bytes.buffer.slice(
        decoded.bytes.byteOffset,
        decoded.bytes.byteOffset + decoded.bytes.byteLength,
    ) as ArrayBuffer;
    return renderMetafileToPng(buffer, decoded.format, target, deps);
}
