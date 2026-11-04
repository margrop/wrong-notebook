/**
 * 把 parseWmf 的解析结果尽力还原为 LaTeX（结构还原）。
 *
 * 背景：MathType / 公式编辑器 3.0 的 OLE 公式对象在 docx 里只有 WMF 预览图。
 * 简单公式（分数、上下标、常见符号）可以通过坐标分析还原为 LaTeX，直接在正文中
 * 以 $…$ 嵌入；复杂图形（多边形、根号、多条斜线等）无法可靠还原时返回 confidence
 * 'low'，由调用方退回「按图片保留 + [公式] 占位」。
 *
 * 还原规则：
 * - 水平线段视为分数线：其 x 范围内、基线在线上方/下方各一组文字 → \frac{上}{下}；
 * - 文字按基线分行、行内按 x 排序拼接；小字号且基线升高/降低 → ^{…} / _{…}；
 * - Symbol / MT Extra 字形映射为 LaTeX 命令（×→\times 等，码点级映射）；
 * - 存在多边形、非水平线、未归属文字等无法解释的内容 → confidence 'low'。
 *
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */

import type { WmfFont, WmfParseResult, WmfTextOp } from "./parser";
import { parseWmf } from "./parser";
import { mapWmfChar } from "./renderer";

/** 结构还原结果 */
export interface WmfLatexResult {
    latex: string;
    confidence: "high" | "low";
}

/** Symbol 字体码点 → LaTeX 命令（按 WMF 单字节码点，与 renderer.ts 的 SYMBOL_CHAR_MAP 对应） */
const SYMBOL_LATEX_MAP: Record<number, string> = {
    0xb4: "\\times",  // ×
    0xb5: "\\div",    // ÷
    0xb1: "\\pm",     // ±
    0xb8: "\\ne",     // ≠
    0xbb: "\\le",     // ≤
    0xbc: "\\ge",     // ≥
    0xbe: "\\approx", // ≈
    0xbf: "\\equiv",  // ≡
    0x70: "\\pi",     // π
    0x65: "\\varepsilon", // ε
    0x66: "\\varphi", // φ
    0xe8: "-",        // −
    0xec: "\\angle",  // ∠
    0xed: "\\parallel", // ∥
    0xf8: "\\perp",   // ⊥
    0xeb: "\\infty",  // ∞
    0xea: "\\sqrt{}", // √
    0x61: "\\alpha", 0x62: "\\beta", 0x67: "\\gamma", 0x64: "\\delta",
    0x7a: "\\zeta", 0x68: "\\eta", 0x71: "\\theta", 0x69: "\\iota",
    0x6b: "\\kappa", 0x6c: "\\lambda", 0x6d: "\\mu", 0x6e: "\\nu",
    0x78: "\\xi", 0x72: "\\rho", 0x73: "\\sigma", 0x74: "\\tau",
    0x75: "\\upsilon", 0x63: "\\chi", 0x79: "\\psi", 0x77: "\\omega",
};

/** MT Extra 字体码点 → LaTeX 命令 */
const MT_EXTRA_LATEX_MAP: Record<number, string> = {
    0x2d: "-",  // −
    0xf0: "\\leftarrow",
    0xf2: "\\rightarrow",
    0xf4: "\\leftrightarrow",
    0xf6: "\\Leftarrow",
    0xf8: "\\Rightarrow",
    0xfa: "\\Leftrightarrow",
};

/** Unicode 数学符号 → LaTeX（mapWmfChar 输出后再走此表） */
const UNICODE_LATEX_MAP: Record<string, string> = {
    "×": "\\times", "÷": "\\div", "≤": "\\le", "≥": "\\ge", "≠": "\\ne",
    "≈": "\\approx", "≡": "\\equiv", "±": "\\pm", "∓": "\\mp",
    "∞": "\\infty", "π": "\\pi", "°": "^\\circ", "∠": "\\angle",
    "⊥": "\\perp", "∥": "\\parallel", "√": "\\sqrt{}", "∴": "\\therefore",
    "∵": "\\because", "∈": "\\in", "∉": "\\notin", "∪": "\\cup", "∩": "\\cap",
    "⊂": "\\subset", "⊆": "\\subseteq", "⊃": "\\supset", "∀": "\\forall",
    "∃": "\\exists", "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∬": "\\iint",
    "→": "\\to", "←": "\\leftarrow", "↔": "\\leftrightarrow",
    "⇒": "\\Rightarrow", "⇔": "\\Leftrightarrow", "⋅": "\\cdot",
    "⊙": "\\odot", "⊗": "\\otimes", "∂": "\\partial", "∇": "\\nabla",
    "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta",
    "ε": "\\varepsilon", "ζ": "\\zeta", "η": "\\eta", "θ": "\\theta",
    "ι": "\\iota", "κ": "\\kappa", "λ": "\\lambda", "μ": "\\mu",
    "ν": "\\nu", "ξ": "\\xi", "ρ": "\\rho", "σ": "\\sigma", "τ": "\\tau",
    "υ": "\\upsilon", "φ": "\\varphi", "χ": "\\chi", "ψ": "\\psi",
    "ω": "\\omega", "Γ": "\\Gamma", "Δ": "\\Delta", "Θ": "\\Theta",
    "Λ": "\\Lambda", "Ξ": "\\Xi", "Π": "\\Pi", "Σ": "\\Sigma",
    "Φ": "\\Phi", "Ψ": "\\Psi", "Ω": "\\Omega",
};

/** 判断字体是否 Symbol（charSet=2 或字体名以 Symbol 开头） */
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

/** 把单个 WMF 字符按字体映射为 LaTeX 片段 */
function mapCharToLatex(char: string, font: WmfFont | null): string {
    const code = char.charCodeAt(0);
    if (isSymbolFont(font)) {
        const mapped = SYMBOL_LATEX_MAP[code];
        if (mapped !== undefined) return mapped;
    }
    if (isMtExtraFont(font)) {
        const mapped = MT_EXTRA_LATEX_MAP[code];
        if (mapped !== undefined) return mapped;
    }
    // 先走 Unicode 映射（mapWmfChar 会把 Symbol 码点转为 Unicode）
    const unicode = mapWmfChar(char, font);
    const latex = UNICODE_LATEX_MAP[unicode];
    if (latex !== undefined) return latex;
    return unicode;
}

/** 内部：带坐标信息的文字项 */
interface TextItem {
    op: WmfTextOp;
    /** 基线 y（= yTop + 0.8×fontSize） */
    baseline: number;
    /** 估算文字宽度（逻辑单位） */
    width: number;
}

/** 估算文字宽度（粗略：字符数 × 字号 × 0.45，Times New Roman 数字约 0.5em 但略窄） */
function estimateTextItemWidth(op: WmfTextOp): number {
    const fontSize = op.font ? Math.abs(op.font.height) : 12;
    return op.text.length * fontSize * 0.45;
}

/** 水平分数线候选 */
interface FractionLine {
    x1: number;
    x2: number;
    y: number;
}

/** 是否有两条分数线在 x 方向重叠且高度不同（嵌套分数或上下叠放的分数） */
function hasStackedFractionLines(lines: FractionLine[]): boolean {
    for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
            const a = lines[i];
            const b = lines[j];
            const overlap = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
            if (overlap > 0 && Math.abs(a.y - b.y) >= 2) return true;
        }
    }
    return false;
}

/** 判断 polyline 是否为水平线（两端 y 差 < 2，长度 > 10） */
function isHorizontalLine(points: Array<{ x: number; y: number }>): boolean {
    if (points.length < 2) return false;
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first.y - last.y) > 2) return false;
    return Math.abs(last.x - first.x) > 10;
}

/** 从 polyline 提取水平分数线候选（取首尾端点确定 x 范围与 y） */
function extractHorizontalLines(parsed: WmfParseResult): FractionLine[] {
    const lines: FractionLine[] = [];
    for (const polyline of parsed.polylines) {
        if (!isHorizontalLine(polyline.points)) continue;
        const first = polyline.points[0];
        const last = polyline.points[polyline.points.length - 1];
        lines.push({
            x1: Math.min(first.x, last.x),
            x2: Math.max(first.x, last.x),
            y: Math.round((first.y + last.y) / 2),
        });
    }
    return lines;
}

/** 判断文字项是否与分数线的 x 范围有实质重叠（用于归属分子/分母） */
function isWithinXRange(item: TextItem, line: FractionLine, tolerance: number): boolean {
    // 文字中心在线的 x 范围内即可（容忍少量溢出）
    const centerX = item.op.x + item.width / 2;
    return centerX >= line.x1 - tolerance && centerX <= line.x2 + tolerance;
}

/** 判断文字项基线是否在分数线上方（分子，基线 < 线 y - 阈值） */
function isAboveLine(item: TextItem, line: FractionLine, threshold: number): boolean {
    return item.baseline < line.y - threshold;
}

/** 判断文字项基线是否在分数线下方（分母，基线 > 线 y + 阈值） */
function isBelowLine(item: TextItem, line: FractionLine, threshold: number): boolean {
    return item.baseline > line.y + threshold;
}

/** 从文字组构造 LaTeX（行内按 x 拼接，处理上下标） */
function groupToLatex(group: TextItem[]): string {
    if (group.length === 0) return "";
    // 找主字号（众数）
    const sizeCounts = new Map<number, number>();
    for (const item of group) {
        const size = item.op.font ? Math.abs(item.op.font.height) : 12;
        sizeCounts.set(size, (sizeCounts.get(size) ?? 0) + 1);
    }
    let mainSize = 12;
    let maxCount = 0;
    for (const [size, count] of sizeCounts) {
        if (count > maxCount || (count === maxCount && size > mainSize)) {
            mainSize = size;
            maxCount = count;
        }
    }

    // 按 x 排序后拼接，处理上下标
    const sorted = [...group].sort((a, b) => a.op.x - b.op.x);
    let result = "";
    for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        const fontSize = item.op.font ? Math.abs(item.op.font.height) : 12;
        const latex = Array.from(item.op.text).map((c) => mapCharToLatex(c, item.op.font)).join("");

        if (fontSize < mainSize * 0.75 && i > 0) {
            // 小字号：判断上标还是下标
            const prev = sorted[i - 1];
            const prevSize = prev.op.font ? Math.abs(prev.op.font.height) : 12;
            const prevBaseline = prev.baseline;
            if (item.baseline < prevBaseline - prevSize * 0.15) {
                // 基线升高 → 上标
                result += `^{${latex}}`;
                continue;
            } else if (item.baseline > prevBaseline + prevSize * 0.15) {
                // 基线降低 → 下标
                result += `_{${latex}}`;
                continue;
            }
        }
        result += latex;
    }
    return result;
}

/**
 * 把 WMF 解析结果尽力还原为 LaTeX。
 *
 * @param parsed parseWmf 的输出
 * @returns latex 为还原结果（可能为空字符串），confidence 为 'high' 或 'low'
 */
export function wmfToLatex(parsed: WmfParseResult): WmfLatexResult {
    // 1. 有多边形 → 无法可靠还原（根号、箭头、几何图形等）
    if (parsed.polygons.length > 0) {
        return { latex: "", confidence: "low" };
    }

    // 2. 提取水平分数线；其余折线（斜线）→ low
    const horizontalLines = extractHorizontalLines(parsed);
    const hasNonHorizontal = parsed.polylines.some((p) => !isHorizontalLine(p.points));
    if (hasNonHorizontal) {
        return { latex: "", confidence: "low" };
    }
    // 嵌套或上下叠放的分数（两条分数线在 x 方向重叠、y 不同）当前无法可靠还原：按图片保留，避免输出错误的 LaTeX
    if (hasStackedFractionLines(horizontalLines)) {
        return { latex: "", confidence: "low" };
    }

    // 3. 构造文字项
    const items: TextItem[] = parsed.texts.map((op) => ({
        op,
        baseline: op.y + Math.round((op.font ? Math.abs(op.font.height) : 12) * 0.8),
        width: estimateTextItemWidth(op),
    }));

    // 4. 用分数线构造分数区域（占用 x/y 范围的合成项）
    interface FractionRegion {
        x1: number;
        x2: number;
        baselineTop: number;   // 区域顶部（分子 yTop）
        baselineBottom: number; // 区域底部（分母 baseline）
        centerY: number;        // 分数线 y
        latex: string;
    }
    const regions: FractionRegion[] = [];
    const consumed = new Set<TextItem>();
    let hasUnexplained = false;

    for (const line of horizontalLines) {
        const tolerance = Math.max(6, (line.x2 - line.x1) * 0.25);
        const numerators = items.filter(
            (item) => !consumed.has(item) && isWithinXRange(item, line, tolerance) && isAboveLine(item, line, 4),
        );
        const denominators = items.filter(
            (item) => !consumed.has(item) && isWithinXRange(item, line, tolerance) && isBelowLine(item, line, 4),
        );
        if (numerators.length === 0 || denominators.length === 0) {
            hasUnexplained = true;
            continue;
        }
        const numLatex = groupToLatex(numerators);
        const denLatex = groupToLatex(denominators);
        if (!numLatex || !denLatex) {
            hasUnexplained = true;
            continue;
        }
        for (const n of numerators) consumed.add(n);
        for (const d of denominators) consumed.add(d);
        regions.push({
            x1: line.x1,
            x2: line.x2,
            baselineTop: Math.min(...numerators.map((i) => i.op.y)),
            baselineBottom: Math.max(...denominators.map((i) => i.baseline)),
            centerY: line.y,
            latex: `\\frac{${numLatex}}{${denLatex}}`,
        });
    }

    // 5. 剩余文字 + 分数区域，按垂直位置分行，行内按 x 排序
    interface LayoutItem {
        x1: number;
        x2: number;
        yTop: number;
        baseline: number;
        latex: string;
        fontSize: number;
    }
    const layoutItems: LayoutItem[] = [];
    for (const item of items) {
        if (consumed.has(item)) continue;
        const fontSize = item.op.font ? Math.abs(item.op.font.height) : 12;
        layoutItems.push({
            x1: item.op.x,
            x2: item.op.x + item.width,
            yTop: item.op.y,
            baseline: item.baseline,
            latex: Array.from(item.op.text).map((c) => mapCharToLatex(c, item.op.font)).join(""),
            fontSize,
        });
    }
    for (const region of regions) {
        // 分数区域字号估算：以区域高度 × 0.5 作为等效字号（用于上下标判断）
        const regionHeight = region.baselineBottom - region.baselineTop;
        layoutItems.push({
            x1: region.x1,
            x2: region.x2,
            yTop: region.baselineTop,
            baseline: region.baselineBottom,
            latex: region.latex,
            fontSize: Math.max(12, Math.round(regionHeight * 0.55)),
        });
    }

    if (layoutItems.length === 0) {
        return { latex: "", confidence: "low" };
    }

    // 按基线聚类成行（行内按 x 排序）
    const sorted = [...layoutItems].sort((a, b) => a.baseline - b.baseline || a.x1 - b.x1);
    const lines: LayoutItem[][] = [];
    for (const item of sorted) {
        const last = lines[lines.length - 1];
        // 阈值：字号的一半（不同项字号可能不同，取两者较大者的一半）
        if (last) {
            const threshold = Math.max(...last.map((l) => l.fontSize), item.fontSize) * 0.35;
            if (Math.abs(last[0].baseline - item.baseline) <= threshold) {
                last.push(item);
                continue;
            }
        }
        lines.push([item]);
    }

    // 6. 逐行拼接（处理上下标）
    const parts: string[] = [];
    for (const line of lines) {
        line.sort((a, b) => a.x1 - b.x1);
        // 主字号：行内最大字号
        const mainSize = Math.max(...line.map((i) => i.fontSize));
        let result = "";
        for (let i = 0; i < line.length; i++) {
            const item = line[i];
            if (item.fontSize < mainSize * 0.72 && i > 0) {
                const prev = line[i - 1];
                if (item.baseline < prev.baseline - prev.fontSize * 0.18) {
                    result += `^{${item.latex}}`;
                    continue;
                }
                if (item.baseline > prev.baseline + prev.fontSize * 0.18) {
                    result += `_{${item.latex}}`;
                    continue;
                }
            }
            result += item.latex;
        }
        parts.push(result);
    }

    const latex = parts.join(" ").trim();
    if (!latex) {
        return { latex: "", confidence: "low" };
    }

    return { latex, confidence: hasUnexplained ? "low" : "high" };
}

/** 便捷入口：WMF 字节 → LaTeX 还原结果；解析失败返回 confidence 'low' */
export function wmfBytesToLatex(bytes: Uint8Array): WmfLatexResult {
    try {
        const parsed = parseWmf(bytes);
        return wmfToLatex(parsed);
    } catch {
        return { latex: "", confidence: "low" };
    }
}
