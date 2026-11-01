import { normalizeFigureAlign, normalizeFigureScale, svgToDataUri } from "@/lib/figure-scale";
import type { FigureAlign } from "@/lib/figure-scale";
import { separateChoiceOptions } from "@/lib/markdown-math";

/** DOCX 内嵌图片数据 */
export interface DocxEmbeddedImage {
    /** PNG 或 JPEG 二进制字节 */
    data: Uint8Array;
    /** 扩展名 */
    extension: "png" | "jpeg";
    /** 在文档中显示的宽度（px，96 DPI） */
    widthPx: number;
    /** 在文档中显示的高度（px，96 DPI） */
    heightPx: number;
    /** 水平对齐方式 */
    align?: FigureAlign;
}

/** DOCX 单个题目区块 */
export interface DocxQuestionBlock {
    /** 题号标题，如 "1." 或 "题目 1" */
    heading: string;
    /** 右侧或次要元信息，如 "来源 ID: ABC123 · 七年级上" */
    meta?: string;
    /** 题干 Markdown / LaTeX 文本 */
    questionText?: string;
    /** 题目配图或原图 */
    image?: DocxEmbeddedImage | null;
    /** 题内直接显示的参考答案（错题打印预览勾选“显示答案”时使用） */
    inlineAnswerLabel?: string;
    inlineAnswerText?: string;
    /** 题内直接显示的解析（错题打印预览勾选“显示解析”时使用） */
    inlineAnalysisLabel?: string;
    inlineAnalysisText?: string;
    /** 题目下方预留的作答留白高度（px） */
    answerSpacePx: number;
}

/** DOCX 独立答案页条目（试卷打印勾选“包含答案页”时使用） */
export interface DocxAnswerKeyBlock {
    heading: string;
    meta?: string;
    answerLabel?: string;
    answerText?: string;
    analysisLabel?: string;
    analysisText?: string;
}

/** DOCX 文档完整规格 */
export interface DocxDocumentSpec {
    title: string;
    /** 试卷抬头行，如 ["姓名：________", "日期：________", "得分：________"] */
    metaItems?: string[];
    questions: DocxQuestionBlock[];
    answerKeyTitle?: string;
    answerKey?: DocxAnswerKeyBlock[];
}

const SUPERSCRIPT_MAP: Record<string, string> = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", "n": "ⁿ",
};

const SUBSCRIPT_MAP: Record<string, string> = {
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
    "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
    "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
};

const LATEX_SYMBOLS: ReadonlyArray<readonly [RegExp, string]> = [
    [/\\times\b/g, "×"],
    [/\\div\b/g, "÷"],
    [/\\cdot\b/g, "·"],
    [/\\pm\b/g, "±"],
    [/\\mp\b/g, "∓"],
    [/\\(?:le|leq)\b/g, "≤"],
    [/\\(?:ge|geq)\b/g, "≥"],
    [/\\(?:ne|neq)\b/g, "≠"],
    [/\\approx\b/g, "≈"],
    [/\\equiv\b/g, "≡"],
    [/\\cong\b/g, "≌"],
    [/\\sim\b/g, "∽"],
    [/\\propto\b/g, "∝"],
    [/\\infty\b/g, "∞"],
    [/\\triangle\b/g, "△"],
    [/\\angle\b/g, "∠"],
    [/\\perp\b/g, "⊥"],
    [/\\parallel\b/g, "∥"],
    [/\\because\b/g, "∵"],
    [/\\therefore\b/g, "∴"],
    [/\\notin\b/g, "∉"],
    [/\\in\b/g, "∈"],
    [/\\subseteq\b/g, "⊆"],
    [/\\subset\b/g, "⊂"],
    [/\\cup\b/g, "∪"],
    [/\\cap\b/g, "∩"],
    [/\\(?:emptyset|varnothing)\b/g, "∅"],
    [/\\forall\b/g, "∀"],
    [/\\exists\b/g, "∃"],
    [/\\Leftrightarrow\b/g, "⇔"],
    [/\\Rightarrow\b/g, "⇒"],
    [/\\(?:to|rightarrow)\b/g, "→"],
    [/\\leftarrow\b/g, "←"],
    [/\\alpha\b/g, "α"],
    [/\\beta\b/g, "β"],
    [/\\gamma\b/g, "γ"],
    [/\\delta\b/g, "δ"],
    [/\\Delta\b/g, "Δ"],
    [/\\(?:epsilon|varepsilon)\b/g, "ε"],
    [/\\theta\b/g, "θ"],
    [/\\lambda\b/g, "λ"],
    [/\\mu\b/g, "μ"],
    [/\\pi\b/g, "π"],
    [/\\rho\b/g, "ρ"],
    [/\\sigma\b/g, "σ"],
    [/\\tau\b/g, "τ"],
    [/\\(?:phi|varphi)\b/g, "φ"],
    [/\\omega\b/g, "ω"],
    [/\\Omega\b/g, "Ω"],
    [/\\sum\b/g, "∑"],
    [/\\prod\b/g, "∏"],
    [/\\int\b/g, "∫"],
];

function mapScriptChars(input: string, table: Record<string, string>, fallbackPrefix: string): string {
    const trimmed = input.trim();
    if (!trimmed) return "";
    const mapped = Array.from(trimmed).map((ch) => table[ch]);
    if (mapped.every(Boolean)) return mapped.join("");
    return trimmed.length === 1 ? `${fallbackPrefix}${trimmed}` : `${fallbackPrefix}(${trimmed})`;
}

/** 将 Markdown 与 LaTeX 数学公式转换为适合在 Word 中直接阅读和编辑的纯文本 */
export function formatMathAndMarkdownForDocx(raw: string): string {
    let text = raw
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\r\n/g, "\n")
        .replace(/\\_/g, "_");

    // 填空横线与空白命令
    text = text
        .replace(/\\underline\{\s*(?:\\quad|\\qquad|\\hspace\{[^}]*\}|\s)*\}/g, "______")
        .replace(/\\underline\{([^{}]*)\}/g, "$1")
        .replace(/\\rule\{[^}]*\}\{[^}]*\}/g, "______")
        .replace(/\\hspace\{[^}]*\}/g, "    ");

    // 分式与根式（支持两层嵌套花括号）
    for (let i = 0; i < 2; i++) {
        text = text.replace(/\\(?:d|t)?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, num: string, den: string) => {
            const n = num.trim();
            const d = den.trim();
            const left = /^[A-Za-z0-9α-ωΑ-Ω]+$/.test(n) ? n : `(${n})`;
            const right = /^[A-Za-z0-9α-ωΑ-Ω]+$/.test(d) ? d : `(${d})`;
            return `${left}/${right}`;
        });
        text = text.replace(/\\sqrt\[([^{}\]]*)\]\{([^{}]*)\}/g, (_, root: string, body: string) => {
            const sup = mapScriptChars(root, SUPERSCRIPT_MAP, "^");
            const b = body.trim();
            return /^[A-Za-z0-9]+$/.test(b) ? `${sup}√${b}` : `${sup}√(${b})`;
        });
        text = text.replace(/\\sqrt\{([^{}]*)\}/g, (_, body: string) => {
            const b = body.trim();
            return /^[A-Za-z0-9]+$/.test(b) ? `√${b}` : `√(${b})`;
        });
    }

    // 角度与上下标
    text = text
        .replace(/\^\{\\circ\}|\^\\circ/g, "°")
        .replace(/\^\{([^{}]+)\}/g, (_, exp: string) => mapScriptChars(exp, SUPERSCRIPT_MAP, "^"))
        .replace(/\^([0-9n+-])/g, (_, exp: string) => mapScriptChars(exp, SUPERSCRIPT_MAP, "^"))
        .replace(/_\{([^{}]+)\}/g, (_, sub: string) => mapScriptChars(sub, SUBSCRIPT_MAP, "_"))
        .replace(/_([0-9+-])/g, (_, sub: string) => mapScriptChars(sub, SUBSCRIPT_MAP, "_"));

    // 常见 LaTeX 文本包装与定界符
    text = text
        .replace(/\\(?:text|mathrm|mathbf|mathit|mathbb|mathcal)\{([^{}]*)\}/g, "$1")
        .replace(/\\(?:left|right)\s*([()[\]|.{])/g, "$1")
        .replace(/\\(?:quad|qquad)\b/g, "  ")
        .replace(/\\[,;!]/g, " ");

    for (const [pattern, replacement] of LATEX_SYMBOLS) {
        text = text.replace(pattern, replacement);
    }

    // 去除公式包裹符与常见 Markdown 标记
    text = text
        .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
        .replace(/\$([^$\n]+)\$/g, "$1")
        .replace(/\\([{}%&#])/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/^#{1,6}\s+/gm, "");

    return separateChoiceOptions(text.trim(), "\n");
}

function escapeXml(value: string): string {
    return value
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
        .replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]!));
}

/** 生成下载用的 .docx 文件名 */
export function docxFileName(title: string): string {
    const cleaned = title.trim().replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
    return `${cleaned || "document"}.docx`;
}

// --- 标准 ZIP (STORE) 打包实现，零外部依赖 ---
const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
    name: string;
    data: Uint8Array;
}

function buildZipArchive(entries: ZipEntry[]): Uint8Array {
    const encoder = new TextEncoder();
    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = encoder.encode(entry.name);
        const data = entry.data;
        const crc = crc32(data);

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(localHeader.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true); // UTF-8
        lv.setUint16(8, 0, true);      // STORE
        lv.setUint16(10, 0, true);
        lv.setUint16(12, 0x21, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        localHeader.set(nameBytes, 30);

        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(centralHeader.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0x21, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        centralHeader.set(nameBytes, 46);

        localParts.push(localHeader, data);
        centralParts.push(centralHeader);
        offset += localHeader.length + data.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const totalSize = offset + centralSize + eocd.length;
    const output = new Uint8Array(totalSize);
    let cursor = 0;
    for (const part of localParts) {
        output.set(part, cursor);
        cursor += part.length;
    }
    for (const part of centralParts) {
        output.set(part, cursor);
        cursor += part.length;
    }
    output.set(eocd, cursor);
    return output;
}

function buildParagraphXml(
    runsXml: string,
    options?: { align?: "left" | "center" | "right"; spaceBeforeDxa?: number; spaceAfterDxa?: number; pageBreakBefore?: boolean; bottomBorder?: boolean },
): string {
    const pPrParts: string[] = [];
    if (options?.pageBreakBefore) pPrParts.push("<w:pageBreakBefore/>");
    if (options?.align && options.align !== "left") {
        pPrParts.push(`<w:jc w:val="${options.align}"/>`);
    }
    if (options?.spaceBeforeDxa !== undefined || options?.spaceAfterDxa !== undefined) {
        const before = options.spaceBeforeDxa ?? 0;
        const after = options.spaceAfterDxa ?? 80;
        pPrParts.push(`<w:spacing w:before="${before}" w:after="${after}" w:line="320" w:lineRule="auto"/>`);
    }
    if (options?.bottomBorder) {
        pPrParts.push('<w:pBdr><w:bottom w:val="dashed" w:sz="4" w:space="4" w:color="CCCCCC"/></w:pBdr>');
    }
    const pPr = pPrParts.length > 0 ? `<w:pPr>${pPrParts.join("")}</w:pPr>` : "";
    return `<w:p>${pPr}${runsXml}</w:p>`;
}

function buildRunXml(text: string, options?: { bold?: boolean; sizeHalfPt?: number; colorHex?: string }): string {
    const rPrParts: string[] = [
        '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei" w:cs="Calibri"/>',
    ];
    if (options?.bold) rPrParts.push("<w:b/>");
    if (options?.sizeHalfPt) rPrParts.push(`<w:sz w:val="${options.sizeHalfPt}"/><w:szCs w:val="${options.sizeHalfPt}"/>`);
    if (options?.colorHex) rPrParts.push(`<w:color w:val="${options.colorHex}"/>`);
    return `<w:r><w:rPr>${rPrParts.join("")}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function buildMultilineParagraphsXml(rawText: string, prefixLabel?: string): string[] {
    const formatted = formatMathAndMarkdownForDocx(rawText);
    const lines = formatted.split("\n");
    return lines.map((line, index) => {
        if (index === 0 && prefixLabel) {
            return buildParagraphXml(
                `${buildRunXml(prefixLabel, { bold: true, colorHex: "333333" })}${buildRunXml(line)}`,
                { spaceBeforeDxa: 40, spaceAfterDxa: 60 },
            );
        }
        return buildParagraphXml(buildRunXml(line), { spaceBeforeDxa: 20, spaceAfterDxa: 60 });
    });
}

function buildDrawingParagraphXml(relId: string, docPrId: number, image: DocxEmbeddedImage): string {
    // 1 px (96 DPI) = 9525 EMU；限制最大宽度为 A4 版心约 600px
    const maxWidthPx = 600;
    const scale = image.widthPx > maxWidthPx ? maxWidthPx / image.widthPx : 1;
    const cx = Math.max(9525, Math.round(image.widthPx * scale * 9525));
    const cy = Math.max(9525, Math.round(image.heightPx * scale * 9525));
    const align = normalizeFigureAlign(image.align);

    const drawingXml = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="Figure ${docPrId}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="image${docPrId}.${image.extension}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    return buildParagraphXml(drawingXml, { align, spaceBeforeDxa: 80, spaceAfterDxa: 80 });
}

/** 根据留白像素高度生成可直接在 Word 中编辑增删的空行段落 */
function buildAnswerSpaceParagraphsXml(answerSpacePx: number): string[] {
    const px = Math.max(0, Math.round(answerSpacePx));
    if (px <= 0) {
        return [buildParagraphXml("", { spaceBeforeDxa: 0, spaceAfterDxa: 80, bottomBorder: true })];
    }
    // 每约 28px 对应一行空段落，方便用户在 Word 中直接按退格或回车调节间距
    const blankLineCount = Math.max(1, Math.round(px / 28));
    const paragraphs: string[] = [];
    for (let i = 0; i < blankLineCount; i++) {
        const isLast = i === blankLineCount - 1;
        paragraphs.push(
            buildParagraphXml("", {
                spaceBeforeDxa: 0,
                spaceAfterDxa: isLast ? 120 : 80,
                bottomBorder: isLast,
            }),
        );
    }
    return paragraphs;
}

/** 将文档规格打包为标准 OpenXML (.docx) 二进制字节 */
export function createDocxArchive(spec: DocxDocumentSpec): Uint8Array {
    const encoder = new TextEncoder();
    const bodyParagraphs: string[] = [];
    const mediaEntries: ZipEntry[] = [];
    const imageRels: string[] = [];
    let imageCounter = 0;

    // 标题
    bodyParagraphs.push(
        buildParagraphXml(buildRunXml(spec.title, { bold: true, sizeHalfPt: 36 }), {
            align: "center",
            spaceBeforeDxa: 0,
            spaceAfterDxa: 160,
        }),
    );

    // 试卷姓名/日期/得分栏
    if (spec.metaItems && spec.metaItems.length > 0) {
        bodyParagraphs.push(
            buildParagraphXml(buildRunXml(spec.metaItems.join("        "), { sizeHalfPt: 22 }), {
                align: "center",
                spaceBeforeDxa: 0,
                spaceAfterDxa: 240,
            }),
        );
    }

    // 题目列表
    for (const q of spec.questions) {
        const headRuns = [
            buildRunXml(q.heading, { bold: true, sizeHalfPt: 24 }),
            ...(q.meta ? [buildRunXml(`    ${q.meta}`, { sizeHalfPt: 18, colorHex: "666666" })] : []),
        ].join("");
        bodyParagraphs.push(buildParagraphXml(headRuns, { spaceBeforeDxa: 160, spaceAfterDxa: 80 }));

        if (q.questionText) {
            bodyParagraphs.push(...buildMultilineParagraphsXml(q.questionText));
        }

        if (q.image && q.image.data.length > 0) {
            imageCounter += 1;
            const relId = `rIdImg${imageCounter}`;
            const fileName = `image${imageCounter}.${q.image.extension}`;
            mediaEntries.push({ name: `word/media/${fileName}`, data: q.image.data });
            imageRels.push(
                `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/>`,
            );
            bodyParagraphs.push(buildDrawingParagraphXml(relId, imageCounter, q.image));
        }

        if (q.inlineAnswerText) {
            bodyParagraphs.push(
                ...buildMultilineParagraphsXml(q.inlineAnswerText, q.inlineAnswerLabel ? `${q.inlineAnswerLabel}：` : undefined),
            );
        }

        if (q.inlineAnalysisText) {
            bodyParagraphs.push(
                ...buildMultilineParagraphsXml(q.inlineAnalysisText, q.inlineAnalysisLabel ? `${q.inlineAnalysisLabel}：` : undefined),
            );
        }

        bodyParagraphs.push(...buildAnswerSpaceParagraphsXml(q.answerSpacePx));
    }

    // 独立答案页
    if (spec.answerKey && spec.answerKey.length > 0) {
        bodyParagraphs.push(
            buildParagraphXml(
                buildRunXml(spec.answerKeyTitle || "参考答案与解析", { bold: true, sizeHalfPt: 30 }),
                { align: "center", pageBreakBefore: true, spaceBeforeDxa: 120, spaceAfterDxa: 200 },
            ),
        );
        for (const item of spec.answerKey) {
            const headRuns = [
                buildRunXml(item.heading, { bold: true, sizeHalfPt: 22 }),
                ...(item.meta ? [buildRunXml(`    ${item.meta}`, { sizeHalfPt: 18, colorHex: "666666" })] : []),
            ].join("");
            bodyParagraphs.push(buildParagraphXml(headRuns, { spaceBeforeDxa: 120, spaceAfterDxa: 60 }));

            if (item.answerText) {
                bodyParagraphs.push(
                    ...buildMultilineParagraphsXml(item.answerText, item.answerLabel ? `${item.answerLabel}：` : undefined),
                );
            }
            if (item.analysisText) {
                bodyParagraphs.push(
                    ...buildMultilineParagraphsXml(item.analysisText, item.analysisLabel ? `${item.analysisLabel}：` : undefined),
                );
            }
        }
    }

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>
${bodyParagraphs.join("\n")}
<w:sectPr>
<w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="450" w:footer="450" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="111111"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
</w:styles>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

    const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${imageRels.join("\n")}
</Relationships>`;

    return buildZipArchive([
        { name: "[Content_Types].xml", data: encoder.encode(contentTypesXml) },
        { name: "_rels/.rels", data: encoder.encode(rootRelsXml) },
        { name: "word/document.xml", data: encoder.encode(documentXml) },
        { name: "word/styles.xml", data: encoder.encode(stylesXml) },
        { name: "word/_rels/document.xml.rels", data: encoder.encode(docRelsXml) },
        ...mediaEntries,
    ]);
}

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx < 0) return null;
    const base64 = dataUrl.slice(commaIdx + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/** 在浏览器中将图片 URL 或 SVG 栅格化为 PNG 字节与目标显示尺寸；失败或非浏览器环境返回 null */
export async function rasterizeImageForDocx(
    src: string,
    options?: { scalePercent?: number; maxBaseWidthPx?: number; align?: FigureAlign | string | null },
): Promise<DocxEmbeddedImage | null> {
    if (typeof window === "undefined" || typeof document === "undefined" || typeof Image === "undefined") {
        return null;
    }
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                const rawW = img.naturalWidth || img.width || 320;
                const rawH = img.naturalHeight || img.height || 200;
                const maxBase = options?.maxBaseWidthPx ?? 560;
                const baseScale = rawW > maxBase ? maxBase / rawW : 1;
                const userScale = (options?.scalePercent ?? 100) / 100;
                const displayW = Math.max(40, Math.round(rawW * baseScale * userScale));
                const displayH = Math.max(30, Math.round(rawH * baseScale * userScale));

                const dpr = 2;
                const canvas = document.createElement("canvas");
                canvas.width = displayW * dpr;
                canvas.height = displayH * dpr;
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    resolve(null);
                    return;
                }
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const bytes = dataUrlToBytes(canvas.toDataURL("image/png"));
                if (!bytes) {
                    resolve(null);
                    return;
                }
                resolve({
                    data: bytes,
                    extension: "png",
                    widthPx: displayW,
                    heightPx: displayH,
                    align: normalizeFigureAlign(options?.align),
                });
            } catch {
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

/** 将题目 SVG 配图转换为 DOCX 内嵌图片 */
export async function rasterizeSvgFigureForDocx(
    svg: string | null | undefined,
    scale?: number | null,
    align?: FigureAlign | string | null,
): Promise<DocxEmbeddedImage | null> {
    if (!svg) return null;
    return rasterizeImageForDocx(svgToDataUri(svg), {
        scalePercent: normalizeFigureScale(scale ?? undefined),
        maxBaseWidthPx: 360,
        align,
    });
}

/** 在浏览器中触发 .docx 文件下载 */
export function triggerDocxDownload(bytes: Uint8Array, title: string): void {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = docxFileName(title);
    link.click();
    URL.revokeObjectURL(url);
}
