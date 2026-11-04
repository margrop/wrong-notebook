/**
 * E3 专用 docx 题库文件构造工具（复制自 src/__tests__/helpers/docx-fixture.ts，
 * 避免 e2e 直接依赖 src/__tests__ 路径）。用 fflate 的 zipSync 动态打包 XML 部件。
 */
import { zipSync } from "fflate";

const XML_ESCAPE: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
};

/** XML 转义（文本节点用） */
export function esc(text: string): string {
    return text.replace(/[&<>"]/g, (char) => XML_ESCAPE[char]);
}

/** 一个最小 run：纯文本 */
export function run(text: string): string {
    return `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** 图片占位 run（w:drawing，含 a:blip 引用 rId4） */
export function drawingRun(): string {
    return `<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rId4"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/** 行内 OMML 公式（m:oMath 包指定子结构） */
export function oMathContent(childrenXml: string): string {
    return `<m:oMath>${childrenXml}</m:oMath>`;
}

/** m:r/m:t（OMML） */
export function mRun(text: string): string {
    return `<m:r><m:t>${esc(text)}</m:t></m:r>`;
}

/** m:f 分数 */
export function mFraction(numXml: string, denXml: string): string {
    return `<m:f><m:num>${numXml}</m:num><m:den>${denXml}</m:den></m:f>`;
}

/** 普通段落 */
export function para(runsXml: string, extraPPr = ""): string {
    const pPr = extraPPr ? `<w:pPr>${extraPPr}</w:pPr>` : "";
    return `<w:p>${pPr}${runsXml}</w:p>`;
}

/** 带自动编号的段落（numId + ilvl） */
export function numPara(numId: string, ilvl: number, runsXml: string): string {
    return `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${runsXml}</w:p>`;
}

/** numbering.xml 的 abstractNum 片段：levels 按 ilvl 顺序给出 */
export function abstractNum(id: string, levels: Array<{ numFmt: string; lvlText: string; start?: number }>): string {
    const levelsXml = levels
        .map(
            (level, index) =>
                `<w:lvl w:ilvl="${index}"><w:start w:val="${level.start ?? 1}"/><w:numFmt w:val="${level.numFmt}"/><w:lvlText w:val="${esc(level.lvlText)}"/></w:lvl>`
        )
        .join("");
    return `<w:abstractNum w:abstractNumId="${id}">${levelsXml}</w:abstractNum>`;
}

/** numbering.xml 的 num 片段 */
export function num(numId: string, abstractNumId: string): string {
    return `<w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractNumId}"/></w:num>`;
}

export interface MinimalDocxOptions {
    /** word/document.xml 的 w:body 子元素 XML（段落、表格等） */
    body: string;
    /** numbering.xml 的 w:abstractNum 与 w:num 片段（可选部件） */
    numbering?: string;
    /** word/_rels/document.xml.rels 的 Relationship 片段（可选部件） */
    rels?: string;
    /** 额外 zip 条目（如 word/media/image1.png），key 为完整文件名 */
    extraFiles?: Record<string, Uint8Array>;
}

/** 构造最小 docx 的 Buffer（供 setInputFiles 直接消费） */
export function makeDocxBuffer(options: MinimalDocxOptions): Buffer {
    const files: Record<string, Uint8Array> = {
        "[Content_Types].xml": new TextEncoder().encode(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
        ),
        "word/document.xml": new TextEncoder().encode(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${options.body}</w:body></w:document>`
        ),
    };
    if (options.numbering !== undefined) {
        files["word/numbering.xml"] = new TextEncoder().encode(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${options.numbering}</w:numbering>`
        );
    }
    if (options.rels !== undefined) {
        files["word/_rels/document.xml.rels"] = new TextEncoder().encode(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${options.rels}</Relationships>`
        );
    }
    if (options.extraFiles) {
        for (const [name, data] of Object.entries(options.extraFiles)) {
            files[name] = data;
        }
    }
    return Buffer.from(zipSync(files, { level: 0 }));
}

/** 旧版 .doc（OLE2）文件头构造（前 8 字节 D0 CF 11 E0 A1 B1 1A E1 + 任意字节） */
export function makeLegacyDocBuffer(): Buffer {
    const bytes = new Uint8Array(16);
    bytes[0] = 0xd0;
    bytes[1] = 0xcf;
    bytes[2] = 0x11;
    bytes[3] = 0xe0;
    bytes[4] = 0xa1;
    bytes[5] = 0xb1;
    bytes[6] = 0x1a;
    bytes[7] = 0xe1;
    for (let i = 8; i < 16; i++) bytes[i] = i;
    return Buffer.from(bytes);
}

/** 1x1 透明 PNG 字节（可直接写成常量） */
export const PNG_1X1: Uint8Array = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
]);
