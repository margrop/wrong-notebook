/**
 * docx 段落文字提取。
 *
 * 规则（README 与 wiki 中同步说明）：
 * - 按顺序拼接 w:r/w:t；w:tab → 制表符，w:br/w:cr → 换行；全角空格保留。
 * - w:sym 按 fonts/symbols.ts 的映射表尽力转换，未识别输出 [符号]。
 * - 上标输出为 ^{…}（纯数字简写为 ^2，如 x^2），下标输出为 _{…}（同规则，如 _2）。
 * - 删除线（w:strike/w:dstrike）与隐藏文字（w:vanish）跳过；
 *   修订内容保留插入（w:ins）、跳过删除（w:del）。
 * - 图片（w:drawing/w:pict/w:object）与公式（m:oMath/m:oMathPara）默认输出占位符
 *   [图片]/[公式]（OLE 公式对象的 w:object 输出 [公式]），可通过 handlers 参数替换（扩展点）。
 *
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
import { mapSymChar } from "@/lib/import/file-parsers/docx/symbols";

/** OMML 公式转换结果的收集器：由 parseDocx 传入，用于跨段落汇总 */
export interface DocxMathCollector {
    /** 未识别的 OMML 元素名（去重、按出现顺序） */
    unsupported: Set<string>;
    /** OLE 公式对象（w:object 中 ProgID 含 Equation）的数量 */
    oleCount: number;
}

/** handlers 回调收到的上下文：供图片/公式提取使用（扩展点） */
export interface DocxContext {
    /** word/_rels/document.xml.rels 解析出的 rId → target 映射 */
    relationships: Record<string, string>;
    /** 解压后的全部 zip 条目（小写文件名 → 字节），供按 target 读取 word/media/* 等 */
    files: Record<string, Uint8Array>;
    /** 公式转换收集器（可选）：parseDocx 传入以汇总 unsupported/OLE 计数 */
    mathCollector?: DocxMathCollector;
}

/** 图片/公式占位处理：element 为对应 w:drawing/w:pict 或 m:oMath/m:oMathPara 元素；
 *  返回 undefined 表示使用默认占位符 */
export interface DocxInlineHandlers {
    /** 默认返回 "[图片]" */
    image?: (element: Element, ctx: DocxContext) => string | undefined;
    /** 默认返回 "[公式]" */
    math?: (element: Element, ctx: DocxContext) => string | undefined;
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";

export const DEFAULT_IMAGE_PLACEHOLDER = "[图片]";
export const DEFAULT_MATH_PLACEHOLDER = "[公式]";

/** 全角空格统一为普通空格（Word 中常见全角空格排版） */
function normalizeFullWidthSpace(text: string): string {
    return text.replace(/　/g, " ");
}

/** 上标/下标包装：纯数字（含负数、小数）用简写 ^2 / _2，其余用 ^{…} / _{…} */
function wrapScript(content: string, marker: "^" | "_"): string {
    const trimmed = content.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return `${marker}${trimmed}`;
    return `${marker}{${trimmed}}`;
}

interface RunContext {
    skip: boolean;
    vertAlign: "baseline" | "superscript" | "subscript";
    handlers: DocxInlineHandlers;
    docxContext: DocxContext;
}

function isElement(node: Node, namespace: string, local: string): node is Element {
    return node.nodeType === node.ELEMENT_NODE && (node as Element).localName === local && (node as Element).namespaceURI === namespace;
}

/** 开关型属性（w:val="0"/"false"/"off" 或缺省表示开启）：读 w:val 判断是否为真 */
function isOn(element: Element): boolean {
    const value = element.getAttributeNS(W, "val");
    if (value === null) return true;
    const normalized = value.trim().toLowerCase();
    return normalized !== "0" && normalized !== "false" && normalized !== "off";
}

/** 解析 w:rPr：删除线/隐藏文字跳过（w:val 关闭时不跳过），上标/下标状态记录 */
function readRunProperties(rPr: Element | null, context: RunContext): void {
    if (!rPr) return;
    const strike = rPr.getElementsByTagNameNS(W, "strike")[0];
    if (strike && isOn(strike)) context.skip = true;
    const dstrike = rPr.getElementsByTagNameNS(W, "dstrike")[0];
    if (dstrike && isOn(dstrike)) context.skip = true;
    const vanish = rPr.getElementsByTagNameNS(W, "vanish")[0];
    if (vanish && isOn(vanish)) context.skip = true;
    const vertAlign = rPr.getElementsByTagNameNS(W, "vertAlign")[0];
    if (vertAlign) {
        const value = vertAlign.getAttributeNS(W, "val") ?? "";
        if (value === "superscript") context.vertAlign = "superscript";
        else if (value === "subscript") context.vertAlign = "subscript";
    }
}

/** 检测元素（w:object 或 w:pict）是否包含 OLE 公式对象 */
function isOleEquationObject(element: Element): boolean {
    const objects = element.localName === "object" && element.namespaceURI === W
        ? [element]
        : Array.from(element.getElementsByTagNameNS(W, "object"));
    for (const object of objects) {
        // OLE 公式编辑器：o:OLEObject 的 ProgID 含 Equation（MathType/Equation.DSMT4 等）
        for (const objectElement of Array.from(object.getElementsByTagName("*"))) {
            const progid = objectElement.getAttribute("ProgID");
            if (progid && /Equation/i.test(progid)) return true;
        }
        // 部分文档（WPS 等）ProgID 为空；形状类型 id 为公式对象专用（_x0000_tole_*）也视为公式
        if (object.getElementsByTagNameNS("urn:schemas-microsoft-com:vml", "shapetype").length > 0) {
            for (const shapetype of Array.from(object.getElementsByTagNameNS("urn:schemas-microsoft-com:vml", "shapetype"))) {
                const id = shapetype.getAttribute("id") ?? "";
                if (/^_x0000_tole_/i.test(id)) return true;
            }
        }
    }
    return false;
}

/** 提取一个 run 的文字（处理 tab/br/sym/上下标/非破坏字符）；w:delText 由调用方跳过 */
function runText(run: Element, context: RunContext): string {
    const rPr = run.getElementsByTagNameNS(W, "rPr")[0] ?? null;
    const runContext: RunContext = { ...context, skip: false, vertAlign: "baseline" };
    readRunProperties(rPr, runContext);
    if (runContext.skip) return "";

    const parts: string[] = [];
    for (const child of Array.from(run.childNodes)) {
        if (child.nodeType === child.TEXT_NODE) continue; // w:t 之外的裸文本按规范不存在，忽略
        if (!isElement(child, W, "t")) continue;
        parts.push(child.textContent ?? "");
    }
    // 处理 w:tab / w:br / w:cr / w:sym / w:drawing / w:pict 等子元素
    let extra = "";
    for (const child of Array.from(run.childNodes)) {
        if (isElement(child, W, "tab")) extra += "\t";
        else if (isElement(child, W, "br") || isElement(child, W, "cr")) extra += "\n";
        else if (isElement(child, W, "noBreakHyphen")) extra += "‑";
        else if (isElement(child, W, "softHyphen")) extra += "\u00ad";
        else if (isElement(child, W, "sym")) {
            const font = child.getAttributeNS(W, "font") ?? "";
            const charHex = child.getAttributeNS(W, "char") ?? "";
            const charCode = parseInt(charHex.replace(/^0x/i, ""), 16);
            extra += Number.isFinite(charCode) ? mapSymChar(font, charCode) : "[符号]";
        } else if (isElement(child, W, "drawing") || isElement(child, W, "pict") || isElement(child, W, "object")) {
            // w:object（run 内直接放 OLE 对象，如 MathType/公式编辑器）与 w:pict/w:drawing 一样提取图片；
            // 图片提取与占位都走 handlers.image（默认按 OLE 公式对象输出 [公式]，否则 [图片]）
            if (isOleEquationObject(child) && context.docxContext.mathCollector) {
                context.docxContext.mathCollector.oleCount += 1;
            }
            extra += context.handlers.image?.(child, context.docxContext) ?? DEFAULT_IMAGE_PLACEHOLDER;
        } else if (isElement(child, M, "oMath") || isElement(child, M, "oMathPara")) {
            extra += context.handlers.math?.(child, context.docxContext) ?? DEFAULT_MATH_PLACEHOLDER;
        }
    }
    if (parts.length === 0) {
        return normalizeFullWidthSpace(extra);
    }
    let text = normalizeFullWidthSpace(parts.join("") + extra);
    if (runContext.vertAlign === "superscript") text = wrapScript(text, "^");
    else if (runContext.vertAlign === "subscript") text = wrapScript(text, "_");
    return text;
}

/** 递归收集段落内所有 run 的文字（w:ins 保留，w:del 跳过） */
function collectRuns(node: Node, context: RunContext, out: string[]): void {
    for (const child of Array.from(node.childNodes)) {
        if (child.nodeType !== child.ELEMENT_NODE) continue;
        const element = child as Element;
        if (isElement(element, W, "ins")) {
            collectRuns(element, context, out);
        } else if (isElement(element, W, "del")) {
            continue; // 修订删除内容跳过
        } else if (isElement(element, W, "r")) {
            out.push(runText(element, context));
        } else if (isElement(element, M, "oMath")) {
            out.push(context.handlers.math?.(element, context.docxContext) ?? DEFAULT_MATH_PLACEHOLDER);
        } else if (isElement(element, M, "oMathPara")) {
            out.push(context.handlers.math?.(element, context.docxContext) ?? DEFAULT_MATH_PLACEHOLDER);
        } else if (isElement(element, W, "hyperlink") || isElement(element, W, "smartTag")) {
            collectRuns(element, context, out);
        } else if (isElement(element, W, "pict") || isElement(element, W, "drawing") || isElement(element, W, "object")) {
            // 与 runText 中一致：w:object（OLE 对象）与 w:pict/w:drawing 提取图片，
            // 占位走 handlers.image（默认按 OLE 公式对象输出 [公式]，否则 [图片]）
            if (isOleEquationObject(element) && context.docxContext.mathCollector) {
                context.docxContext.mathCollector.oleCount += 1;
            }
            out.push(context.handlers.image?.(element, context.docxContext) ?? DEFAULT_IMAGE_PLACEHOLDER);
        } else {
            collectRuns(element, context, out);
        }
    }
}

/** 提取段落纯文本（含编号文本拼接前的段落文字） */
export function paragraphText(paragraph: Element, handlers: DocxInlineHandlers = {}, docxContext: DocxContext = { relationships: {}, files: {} }): string {
    const parts: string[] = [];
    collectRuns(paragraph, { skip: false, vertAlign: "baseline", handlers, docxContext }, parts);
    return parts.join("");
}

/** 提取表格单元格文字：单元格内多段用空格连接，含嵌套表格占位 */
export function cellText(cell: Element, handlers: DocxInlineHandlers = {}, docxContext: DocxContext = { relationships: {}, files: {} }): string {
    const parts: string[] = [];
    for (const child of Array.from(cell.childNodes)) {
        if (child.nodeType !== child.ELEMENT_NODE) continue;
        const element = child as Element;
        if (isElement(element, W, "p")) {
            const text = paragraphText(element, handlers, docxContext);
            if (text.trim()) parts.push(text);
        } else if (isElement(element, W, "tbl")) {
            // 嵌套表格：展开为行（本表作为单元格内容的补充）
            for (const row of tableRows(element, handlers, docxContext)) {
                if (row.trim()) parts.push(row);
            }
        }
    }
    return parts.join(" ");
}

/** 提取表格的一行：单元格文字用制表符连接；嵌套表格展开到对应单元格位置 */
export function tableRowText(row: Element, handlers: DocxInlineHandlers = {}, docxContext: DocxContext = { relationships: {}, files: {} }): string {
    const cells: string[] = [];
    for (const child of Array.from(row.childNodes)) {
        if (child.nodeType !== child.ELEMENT_NODE) continue;
        const element = child as Element;
        if (isElement(element, W, "tc")) {
            cells.push(cellText(element, handlers, docxContext).trim());
        }
    }
    return cells.join("\t");
}

/** 提取表格所有行的文字（嵌套表格展开） */
export function tableRows(table: Element, handlers: DocxInlineHandlers = {}, docxContext: DocxContext = { relationships: {}, files: {} }): string[] {
    const rows: string[] = [];
    for (const child of Array.from(table.childNodes)) {
        if (child.nodeType !== child.ELEMENT_NODE) continue;
        const element = child as Element;
        if (isElement(element, W, "tr")) {
            rows.push(tableRowText(element, handlers, docxContext));
        }
    }
    return rows;
}

/** 按文档顺序提取 body 内段落与表格行，组成全文行列表（供分题使用） */
export function documentLines(document: Document, handlers: DocxInlineHandlers = {}, docxContext: DocxContext = { relationships: {}, files: {} }): string[] {
    const body = document.getElementsByTagNameNS(W, "body")[0];
    if (!body) return [];
    const lines: string[] = [];
    const walk = (node: Node) => {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType !== child.ELEMENT_NODE) continue;
            const element = child as Element;
            if (isElement(element, W, "p")) {
                lines.push(paragraphText(element, handlers, docxContext));
            } else if (isElement(element, W, "tbl")) {
                for (const row of tableRows(element, handlers, docxContext)) {
                    lines.push(row);
                }
            } else if (isElement(element, W, "sdt")) {
                // 内容控件：递归其内容
                walk(element);
            }
        }
    };
    walk(body);
    return lines;
}
