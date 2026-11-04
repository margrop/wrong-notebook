/**
 * PDF 文字层还原为纯文本的纯函数算法：
 * - 按文字项坐标还原行（同 y 按 x 拼接、间距大补空格）
 * - 双栏检测（页面左右两半各自有文字且中缝空白）
 * - 跨页页眉页脚检测与移除（出现在超过一半页面的顶部/底部相同文字）
 *
 * 输入为 { str, x, y, width, height, page } 数组（由 parse.ts 从 pdfjs TextItem 提取），
 * 不依赖 pdfjs 与 Node 专有模块，可在浏览器和服务端使用，也便于构造数据单测。
 */

/** pdfjs TextItem 提取出的最小文字项（坐标为 PDF 用户空间，y 自下而上） */
export interface PdfTextItem {
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
    page: number;
}

/** 还原后的一行（page 从 1 开始，yTop 为自上而下的行顶位置） */
export interface PdfLine {
    text: string;
    x: number;
    yTop: number;
    height: number;
    page: number;
}

/** 页眉页脚判定与行距相关的常量（字号比例） */
const LINE_Y_TOLERANCE_RATIO = 0.5;
const WORD_GAP_RATIO = 0.15;
const DOUBLE_COLUMN_GAP_RATIO = 0.06;
const MIN_COLUMN_TEXT_RATIO = 0.25;
const HEADER_FOOTER_MIN_PAGES_RATIO = 0.5;
const HEADER_FOOTER_TOP_LIMIT_RATIO = 0.15;
const HEADER_FOOTER_BOTTOM_LIMIT_RATIO = 0.92;
const PAGE_NUMBER_PATTERN = /^[\s\-–—·.．]*\d{1,4}[\s\-–—·.．]*$/;

/** 连字与全角空格归一：保留上下标的原始字符，不做公式识别 */
export function normalizePdfText(raw: string): string {
    return raw
        .replace(/\uFB00/g, "ff")
        .replace(/\uFB01/g, "fi")
        .replace(/\uFB02/g, "fl")
        .replace(/\uFB03/g, "ffi")
        .replace(/\uFB04/g, "ffl")
        .replace(/\u00A0/g, " ")
        .replace(/\u3000/g, " ");
}

interface PageInfo {
    width: number;
    height: number;
}

/** 页眉页脚签名：去掉全部数字后的文字；纯页码类（或去数字后为空）单独标记 */
interface HeaderSignature {
    key: string;
    isPageNumberOnly: boolean;
}

/** 页眉页脚签名分组：出现在足够多页面顶部/底部的相同签名即移除 */
interface HeaderGroup {
    key: string;
    pages: Set<number>;
    isPageNumberOnly: boolean;
    minYTop: number;
    maxYTopBottom: number;
}

function headerSignature(text: string): HeaderSignature | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (PAGE_NUMBER_PATTERN.test(trimmed)) return { key: "", isPageNumberOnly: true };
    const key = trimmed.replace(/\d+/g, "").trim();
    if (!key) return null;
    return { key, isPageNumberOnly: false };
}

/**
 * 从每页尺寸与文字项集合还原各行（纯函数核心）。
 *
 * 流程：
 * 1. 每页独立按 y 聚类成行、行内按 x 排序拼接；
 * 2. 双栏页面先输出左栏后输出右栏（栏内按 y 自上而下）；
 * 3. 跨页统计顶部/底部行签名，出现在 ≥一半页面且同位置的相同签名视为页眉页脚并移除
 *    （页码差异被签名归一吸收：「第 3 页」「- 3 -」去数字后签名相同）。
 *
 * @param items  全部文字项（坐标原样来自 PDF 用户空间，y 自下而上）
 * @param pages  每页尺寸（page 从 1 开始；缺失时按该项所在页的文字推断边界）
 */
export function reconstructLines(items: PdfTextItem[], pages: PageInfo[]): PdfLine[] {
    const normalized = items.map((item) => ({ ...item, str: normalizePdfText(item.str) })).filter((item) => item.str.trim().length > 0);
    const lines = groupIntoLines(normalized, pages);
    const columns = detectColumns(normalized, pages);
    const headerGroups = collectHeaderGroups(lines, pages);
    const headerLines = new Set<PdfLine>();
    for (const group of headerGroups) {
        for (const line of lines) {
            if (line.page < 1 || !group.pages.has(line.page)) continue;
            const sig = headerSignature(line.text);
            if (sig?.key !== group.key) continue;
            if (group.isPageNumberOnly && !sig.isPageNumberOnly) continue;
            if (line.yTop >= group.minYTop && line.yTop <= group.maxYTopBottom) headerLines.add(line);
        }
    }
    return lines
        .filter((line) => !headerLines.has(line))
        .sort((a, b) => (a.page - b.page) || (a.yTop - b.yTop) || (a.x - b.x))
        .map((line) => {
            const column = columns.get(line.page);
            if (!column) return line;
            const center = column.width / 2;
            // 双栏页面：右栏排在同页左栏之后
            return { ...line, yTop: line.x >= center ? line.yTop + column.height : line.yTop };
        })
        .sort((a, b) => (a.page - b.page) || (a.yTop - b.yTop) || (a.x - b.x));
}

/** 同 y（容差按字号比例）的文字项聚为一行，行内按 x 排序拼接，间距较大时补空格 */
function groupIntoLines(items: PdfTextItem[], pages: PageInfo[]): PdfLine[] {
    const byPage = new Map<number, PdfTextItem[]>();
    for (const item of items) {
        const list = byPage.get(item.page) ?? [];
        list.push(item);
        byPage.set(item.page, list);
    }
    const lines: PdfLine[] = [];
    for (const [page, pageItems] of byPage) {
        const info = pages.find((entry, index) => index + 1 === page);
        const pageHeight = info?.height ?? 0;
        const sorted = [...pageItems].sort((a, b) => (a.y - b.y) || (a.x - b.x));
        const rows: PdfTextItem[][] = [];
        for (const item of sorted) {
            const row = rows[rows.length - 1];
            const last = row?.[row.length - 1];
            const tolerance = Math.max(item.height, last?.height ?? 0) * LINE_Y_TOLERANCE_RATIO;
            if (row && last && Math.abs(item.y - last.y) <= tolerance) {
                row.push(item);
            } else {
                rows.push([item]);
            }
        }
        for (const row of rows) {
            row.sort((a, b) => a.x - b.x);
            let text = "";
            let prev: PdfTextItem | null = null;
            for (const item of row) {
                if (prev) {
                    const gap = item.x - (prev.x + prev.width);
                    const size = Math.max(item.height, prev.height, 1);
                    if (gap > size * WORD_GAP_RATIO && !text.endsWith(" ") && !item.str.startsWith(" ") && !isCjk(text[text.length - 1]) && !isCjk(item.str[0])) {
                        text += " ";
                    }
                }
                text += item.str;
                prev = item;
            }
            const height = row.reduce((sum, item) => Math.max(sum, item.height), 0);
            const y = row.reduce((sum, item) => sum + item.y, 0) / row.length;
            // yTop 为自上而下的行顶位置：y 是自下而上的基线，行顶在基线之上一个字高处
            lines.push({ text: text.trimEnd(), x: row[0].x, yTop: pageHeight - y - height, height, page });
        }
    }
    return lines;
}

function isCjk(char: string | undefined): boolean {
    if (!char) return false;
    const code = char.charCodeAt(0);
    return (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0x3000 && code <= 0x303f) || (code >= 0xff00 && code <= 0xffef);
}

/** 双栏检测：页面左右两半各自文字量 ≥25%，且中缝 ±3% 宽度内没有文字 */
function detectColumns(items: PdfTextItem[], pages: PageInfo[]): Map<number, { width: number; height: number }> {
    const result = new Map<number, { width: number; height: number }>();
    const byPage = new Map<number, PdfTextItem[]>();
    for (const item of items) {
        const list = byPage.get(item.page) ?? [];
        list.push(item);
        byPage.set(item.page, list);
    }
    for (const [page, pageItems] of byPage) {
        const info = pages.find((entry, index) => index + 1 === page);
        if (!info || info.width <= 0) continue;
        const center = info.width / 2;
        const gapHalf = info.width * DOUBLE_COLUMN_GAP_RATIO;
        const leftText = pageItems
            .filter((item) => item.x + item.width <= center + gapHalf)
            .reduce((sum, item) => sum + item.str.trim().length, 0);
        const rightText = pageItems
            .filter((item) => item.x >= center - gapHalf)
            .reduce((sum, item) => sum + item.str.trim().length, 0);
        const total = leftText + rightText;
        if (total < 1) continue;
        const gutter = pageItems.some((item) => item.x < center + gapHalf && item.x + item.width > center - gapHalf);
        if (!gutter && leftText >= total * MIN_COLUMN_TEXT_RATIO && rightText >= total * MIN_COLUMN_TEXT_RATIO) {
            result.set(page, { width: info.width, height: info.height });
        }
    }
    return result;
}

/**
 * 跨页收集页眉页脚签名：只统计出现在页面顶部（yTop < 15% 页高）或底部（> 92%）的行；
 * 相同签名（忽略页码数字）出现在超过一半的页面时，按该组的 yTop 范围移除对应行。
 */
function collectHeaderGroups(lines: PdfLine[], pages: PageInfo[]): HeaderGroup[] {
    const pageNumbers = [...new Set(lines.map((line) => line.page))].filter((page) => page >= 1);
    if (pageNumbers.length === 0) return [];
    const pageCount = pages.length || pageNumbers.length;
    const minPages = Math.max(2, Math.ceil(pageCount * HEADER_FOOTER_MIN_PAGES_RATIO));
    const groups = new Map<string, HeaderGroup>();
    for (const line of lines) {
        const info = pages.find((entry, index) => index + 1 === line.page);
        const height = info?.height ?? 0;
        if (height <= 0) continue;
        const inHeaderZone = line.yTop <= height * HEADER_FOOTER_TOP_LIMIT_RATIO;
        const inFooterZone = line.yTop >= height * HEADER_FOOTER_BOTTOM_LIMIT_RATIO;
        if (!inHeaderZone && !inFooterZone) continue;
        if (line.text.length > 100) continue;
        const sig = headerSignature(line.text);
        if (!sig) continue;
        const key = `${inHeaderZone ? "H" : "F"}:${sig.key}:${sig.isPageNumberOnly ? "#" : "*"}`;
        const existing = groups.get(key);
        if (existing) {
            existing.pages.add(line.page);
            existing.minYTop = Math.min(existing.minYTop, line.yTop);
            existing.maxYTopBottom = Math.max(existing.maxYTopBottom, line.yTop);
        } else {
            groups.set(key, { key: sig.key, pages: new Set([line.page]), isPageNumberOnly: sig.isPageNumberOnly, minYTop: line.yTop, maxYTopBottom: line.yTop });
        }
    }
    return [...groups.values()].filter((group) => group.pages.size >= minPages);
}

/** 把还原后的行拼为全文（逐页衔接，行间用换行） */
export function linesToText(lines: PdfLine[]): string {
    return lines.map((line) => line.text).join("\n");
}
