/**
 * 把 parseWmf 的解析结果渲染为 SVG 字符串。
 *
 * - viewBox 来自窗口原点与范围（或 placeable bbox），输出 1:1 逻辑单位映射到用户单位；
 * - 文字逐条输出为 <text>，坐标已按 TA_UPDATECP/dx 数组/对齐标志换算；
 * - font-family 映射为通用字体栈（Times New Roman → "Times New Roman", serif）；
 * - Symbol 字体字符按码点映射为 Unicode 数学符号；MT Extra 等私有字体做常见字形尽力映射。
 *
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */

import type { WmfFont, WmfParseResult } from "./parser";
import { TA_MASK_H, TA_CENTER, TA_RIGHT, parseWmf } from "./parser";

/** Symbol 字体字符 → Unicode 数学符号（与 src/lib/import/file-parsers/docx/symbols.ts 的 SYMBOL_MAP 互补，按 WMF 单字节码点） */
const SYMBOL_CHAR_MAP: Record<number, string> = {
    0x61: "α", 0x62: "β", 0x67: "γ", 0x64: "δ", 0x65: "ε",
    0x7a: "ζ", 0x68: "η", 0x71: "θ", 0x69: "ι", 0x6b: "κ",
    0x6c: "λ", 0x6d: "μ", 0x6e: "ν", 0x78: "ξ", 0x70: "π",
    0x72: "ρ", 0x73: "σ", 0x74: "τ", 0x75: "υ", 0x66: "φ",
    0x63: "χ", 0x79: "ψ", 0x77: "ω",
    0x41: "Α", 0x42: "Β", 0x47: "Γ", 0x44: "Δ", 0x45: "Ε",
    0x5a: "Ζ", 0x48: "Η", 0x51: "Θ", 0x49: "Ι", 0x4b: "Κ",
    0x4c: "Λ", 0x4d: "Μ", 0x4e: "Ν", 0x58: "Ξ", 0x50: "Π",
    0x52: "Ρ", 0x53: "Σ", 0x54: "Τ", 0x55: "Υ", 0x46: "Φ",
    0x43: "Χ", 0x59: "Ψ", 0x57: "Ω",
    0xb4: "×", 0xb5: "÷", 0xb1: "±", 0xb2: "·", 0xb3: "∙",
    0xb6: "∂", 0xb8: "≠", 0xbb: "≤", 0xbc: "≥", 0xbe: "≈",
    0xbf: "≡", 0xc2: "∈", 0xc5: "∉", 0xc6: "∋", 0xc9: "∅",
    0xce: "∩", 0xcf: "∪", 0xd2: "⊂", 0xd3: "⊃", 0xd4: "⊄",
    0xd5: "⊆", 0xd6: "⊇", 0xdb: "∧", 0xdc: "∨", 0xdd: "¬",
    0xde: "⇒", 0xdf: "⇔", 0xe0: "∀", 0xe1: "∃", 0xe2: "∄",
    0xe3: "∅", 0xe4: "∆", 0xe5: "∇", 0xe6: "∏", 0xe7: "∑",
    0xe8: "−", 0xe9: "∗", 0xea: "√", 0xeb: "∞", 0xec: "∠",
    0xed: "∥", 0xee: "∧", 0xef: "∨", 0xf0: "∩", 0xf1: "∪",
    0xf2: "∫", 0xf3: "∬", 0xf4: "∴", 0xf5: "∵", 0xf6: "∶",
    0xf7: "∷", 0xf8: "⊥", 0xf9: "∟", 0xfa: "⌒", 0xfb: "⊙",
    0xfc: "○", 0xfd: "●", 0xfe: "□", 0xff: "■",
};

/**
 * MT Extra 字体（MathType 私有）常见字形 → Unicode 尽力映射。
 * 键为 MT Extra 单字节码点；未覆盖的码点保留原字符。
 */
const MT_EXTRA_CHAR_MAP: Record<number, string> = {
    0x28: "(", 0x29: ")", 0x5b: "[", 0x5d: "]",
    0x7b: "{", 0x7d: "}",
    0x2d: "−", 0x3d: "=", 0x2b: "+",
    0x3c: "<", 0x3e: ">",
    0x2026: "…",
    // 括号类（MT Extra 用重码区表示可伸缩括号，尽力映射）
    0xe0: "(", 0xe1: ")", 0xe2: "[", 0xe3: "]",
    0xe4: "{", 0xe5: "}",
    0xe6: "⟨", 0xe7: "⟩",
    0xe8: "⌈", 0xe9: "⌉", 0xea: "⌊", 0xeb: "⌋",
    // 省略号与箭头
    0xec: "…", 0xed: "⋯", 0xee: "⋮", 0xef: "⋱",
    0xf0: "←", 0xf1: "↑", 0xf2: "→", 0xf3: "↓",
    0xf4: "↔", 0xf5: "↕", 0xf6: "⇐", 0xf7: "⇑",
    0xf8: "⇒", 0xf9: "⇓", 0xfa: "⇔",
};

/** 判断字体是否 Symbol 字体（charSet=2 或字体名以 Symbol 开头） */
function isSymbolFont(font: WmfFont | null): boolean {
    if (!font) return false;
    if (font.charSet === 2) return true;
    return font.faceName.trim().toLowerCase().startsWith("symbol");
}

/** 判断字体是否 MT Extra（MathType 私有字体） */
function isMtExtraFont(font: WmfFont | null): boolean {
    if (!font) return false;
    return font.faceName.trim().toLowerCase().startsWith("mt extra");
}

/** 把 WMF 单字符按字体映射为可显示字符；无法映射时保留原字符 */
export function mapWmfChar(char: string, font: WmfFont | null): string {
    if (isSymbolFont(font)) {
        const code = char.charCodeAt(0);
        const mapped = SYMBOL_CHAR_MAP[code];
        if (mapped !== undefined) return mapped;
        return char;
    }
    if (isMtExtraFont(font)) {
        const code = char.charCodeAt(0);
        const mapped = MT_EXTRA_CHAR_MAP[code];
        if (mapped !== undefined) return mapped;
        return char;
    }
    return char;
}

/** 把字体名映射为通用字体栈（字体名用单引号包裹，避免与外层双引号冲突） */
export function mapFontFamily(faceName: string): string {
    const normalized = faceName.trim().toLowerCase();
    if (normalized.startsWith("times")) return "'Times New Roman', 'Nimbus Roman', serif";
    if (normalized.startsWith("arial") || normalized.startsWith("helvetica")) return "Arial, 'Helvetica Neue', sans-serif";
    if (normalized.startsWith("courier")) return "'Courier New', Courier, monospace";
    if (normalized.startsWith("symbol")) return "Symbol, 'Times New Roman', serif";
    if (normalized.startsWith("mt extra")) return "'Times New Roman', serif";
    if (normalized.startsWith("宋") || normalized.includes("song") || normalized.includes("simsun")) return "'SimSun', 'Songti SC', serif";
    if (normalized.includes("hei") || normalized.includes("simhei")) return "'SimHei', 'Heiti SC', sans-serif";
    if (normalized.includes("kai") || normalized.includes("kaiti")) return "'Kaiti SC', KaiTi, serif";
    return `'${faceName}', serif`;
}

/** 把 0xRRGGBB 整数转为 CSS 颜色 */
function colorToCss(color: number): string {
    return `#${color.toString(16).padStart(6, "0")}`;
}

/** XML 转义 */
function escapeXml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** 字体样式声明（font-size 用绝对值，单位为用户单位） */
function fontStyleDecl(font: WmfFont | null): string {
    if (!font) return 'font-size="12"';
    const size = Math.abs(font.height);
    const styles: string[] = [`font-size="${size}"`];
    if (font.bold) styles.push('font-weight="bold"');
    if (font.italic) styles.push('font-style="italic"');
    const family = escapeXml(mapFontFamily(font.faceName));
    styles.push(`font-family="${family}"`);
    return styles.join(" ");
}

/** 把解析结果渲染为 SVG 字符串；viewBox 可能宽高为 0 或负，做最小保护 */
export function renderWmfSvg(parsed: WmfParseResult): string {
    const vb = parsed.viewBox;
    const vbWidth = Math.max(1, Math.abs(vb.width));
    const vbHeight = Math.max(1, Math.abs(vb.height));
    const vbX = vb.width >= 0 ? vb.x : vb.x + vb.width;
    const vbY = vb.height >= 0 ? vb.y : vb.y + vb.height;

    const parts: string[] = [];
    parts.push(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbWidth} ${vbHeight}" width="${vbWidth}" height="${vbHeight}">`,
    );
    parts.push('<rect x="-32768" y="-32768" width="65536" height="65536" fill="#ffffff"/>');

    for (const polygon of parsed.polygons) {
        const points = polygon.points.map((p) => `${p.x},${p.y}`).join(" ");
        parts.push(`<polygon points="${points}" fill="none" stroke="${colorToCss(polygon.color)}" stroke-width="1"/>`);
    }

    for (const polyline of parsed.polylines) {
        const points = polyline.points.map((p) => `${p.x},${p.y}`).join(" ");
        parts.push(`<polyline points="${points}" fill="none" stroke="${colorToCss(polyline.color)}" stroke-width="1"/>`);
    }

    for (const text of parsed.texts) {
        const chars = Array.from(text.text).map((c) => mapWmfChar(c, text.font)).join("");
        const anchor = text.x;
        // SVG text 默认基线对齐：y 已是文字顶部，需加上行高换算为基线
        const fontSize = text.font ? Math.abs(text.font.height) : 12;
        const baselineY = text.y + Math.round(fontSize * 0.8);
        const hAlign = text.align & TA_MASK_H;
        const textAnchor = hAlign === TA_CENTER ? ' text-anchor="middle"' : hAlign === TA_RIGHT ? ' text-anchor="end"' : "";
        parts.push(
            `<text x="${anchor}" y="${baselineY}" fill="${colorToCss(text.color)}"${textAnchor} ${fontStyleDecl(text.font)}>${escapeXml(chars)}</text>`,
        );
    }

    parts.push("</svg>");
    return parts.join("\n");
}

/** 便捷入口：WMF 字节 → SVG 字符串；解析失败抛出 Error */
export function wmfBytesToSvg(bytes: Uint8Array): string {
    return renderWmfSvg(parseWmf(bytes));
}
