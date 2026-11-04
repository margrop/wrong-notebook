/**
 * 测试用最小 docx 构造工具：用 fflate 的 zipSync 动态打包 XML 部件。
 * 只生成与题库解析相关的三个部件（document/numbering/styles），
 * 供 docx 解析器与后续任务复用。
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
export function run(text: string, extra = ""): string {
    return `<w:r>${extra}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** 上标 run */
export function supRun(text: string): string {
    return `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** 下标 run */
export function subRun(text: string): string {
    return `<w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** 删除线 run（可指定 w:val，如 "0" 表示关闭） */
export function strikeRun(text: string, val?: string): string {
    const valAttr = val !== undefined ? ` w:val="${val}"` : "";
    return `<w:r><w:rPr><w:strike${valAttr}/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** 双删除线 run */
export function dstrikeRun(text: string, val?: string): string {
    const valAttr = val !== undefined ? ` w:val="${val}"` : "";
    return `<w:r><w:rPr><w:dstrike${valAttr}/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** 隐藏文字 run（可指定 w:val，如 "0" 表示关闭） */
export function vanishRun(text: string, val?: string): string {
    const valAttr = val !== undefined ? ` w:val="${val}"` : "";
    return `<w:r><w:rPr><w:vanish${valAttr}/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** 制表符 run */
export function tabRun(): string {
    return "<w:r><w:tab/></w:r>";
}

/** 软换行 run */
export function brRun(): string {
    return "<w:r><w:br/></w:r>";
}

/** w:sym 符号 run */
export function symRun(font: string, charCodeHex: string): string {
    return `<w:r><w:sym w:font="${font}" w:char="${charCodeHex}"/></w:r>`;
}

/** 修订插入（保留） */
export function insRun(runsXml: string, id: number, author = "test"): string {
    return `<w:ins w:id="${id}" w:author="${author}" w:date="2026-01-01T00:00:00Z">${runsXml}</w:ins>`;
}

/** 修订删除（跳过） */
export function delRun(text: string, id: number, author = "test"): string {
    return `<w:del w:id="${id}" w:author="${author}" w:date="2026-01-01T00:00:00Z"><w:r><w:delText xml:space="preserve">${esc(text)}</w:delText></w:r></w:del>`;
}

/** 图片占位 run（w:drawing，含 a:blip 引用 rId4） */
export function drawingRun(): string {
    return `<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rId4"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/** 公式占位（m:oMath，默认输出 [公式]） */
export function oMathRun(): string {
    return `<m:oMath><m:r><w:t>x+y</w:t></m:r></m:oMath>`;
}

/** 行内 OMML 公式（m:oMath 包指定子结构） */
export function oMathContent(childrenXml: string): string {
    return `<m:oMath>${childrenXml}</m:oMath>`;
}

/** m:oMathPara 块级公式 */
export function oMathPara(childrenXml: string): string {
    return `<m:oMathPara>${childrenXml}</m:oMathPara>`;
}

/** m:r/m:t（OMML） */
export function mRun(text: string): string {
    return `<m:r><m:t>${esc(text)}</m:t></m:r>`;
}

/** m:f 分数 */
export function mFraction(numXml: string, denXml: string): string {
    return `<m:f><m:num>${numXml}</m:num><m:den>${denXml}</m:den></m:f>`;
}

/** m:sSup 上标 */
export function mSup(baseXml: string, supXml: string): string {
    return `<m:sSup><m:e>${baseXml}</m:e><m:sup>${supXml}</m:sup></m:sSup>`;
}

/** m:sSub 下标 */
export function mSub(baseXml: string, subXml: string): string {
    return `<m:sSub><m:e>${baseXml}</m:e><m:sub>${subXml}</m:sub></m:sSub>`;
}

/** m:d 分隔符（可选 begChr/endChr） */
export function mDelimited(childrenXml: string, begChr?: string, endChr?: string): string {
    const dPr = begChr !== undefined || endChr !== undefined
        ? `<m:dPr>${begChr !== undefined ? `<m:begChr m:val="${esc(begChr)}"/>` : ""}${endChr !== undefined ? `<m:endChr m:val="${esc(endChr)}"/>` : ""}</m:dPr>`
        : "";
    return `<m:d>${dPr}<m:e>${childrenXml}</m:e></m:d>`;
}

/** OLE 公式对象（MathType 等：w:pict > v:shape > w:object > o:OLEObject，ProgID 含 Equation） */
export function oleEquationRun(progId = "Equation.DSMT4"): string {
    return `<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" style="width:100pt;height:20pt"><w:object w:dxaOrig="1000" w:dyaOrig="200"><v:imagedata r:id="rId5"/><o:OLEObject Type="Embed" ProgID="${esc(progId)}"/></w:object></v:shape></w:pict></w:r>`;
}

/** OLE 公式对象（w:pict 形态，v:imagedata 引用 WMF），v:shape 指定 pt 显示尺寸 */
export function oleEquationWmfRun(rid = "rIdWmf", style = "width:50pt;height:25pt"): string {
    return `<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" style="${esc(style)}"><w:object w:dxaOrig="1000" w:dyaOrig="500"><v:imagedata r:id="${esc(rid)}"/><o:OLEObject Type="Embed" ProgID="Equation.DSMT4"/></w:object></v:shape></w:pict></w:r>`;
}

/**
 * OLE 公式对象（真实文档形态：run 内直接放 w:object，MathType/公式编辑器 3.0）。
 * w:object 内含 v:shapetype（公式专用 id _x0000_tole_*）、v:shape（style 指定显示尺寸）
 * 与 o:OLEObject；v:imagedata 的 r:id 指向 word/media/imageN.wmf（rels 中 Type 为 image）。
 * progId 传空字符串可模拟 WPS 等 ProgID 为空的文档。
 */
export function oleObjectRun(imageRid = "rIdWmf", objectRid = "rIdOle", style = "width:10pt;height:28pt", progId = "Equation.DSMT4"): string {
    const progidAttr = progId ? ` ProgID="${esc(progId)}"` : ` ProgID=""`;
    return `<w:r><w:object w:dxaOrig="200" w:dyaOrig="560"><v:shapetype xmlns:v="urn:schemas-microsoft-com:vml" id="_x0000_tole_${esc(objectRid)}" coordsize="21600,21600" o:spt="75" adj="16200" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:formulas/><v:path/><o:lock xmlns:o="urn:schemas-microsoft-com:office:office" v:ext="edit"/></v:shapetype><v:shape xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" id="ole_${esc(objectRid)}" type="#_x0000_tole_${esc(objectRid)}" style="${esc(style)}" filled="f" o:ole=""><v:imagedata r:id="${esc(imageRid)}" o:title=""/></v:shape><o:OLEObject xmlns:o="urn:schemas-microsoft-com:office:office" Type="Embed"${progidAttr} ShapeID="ole_${esc(objectRid)}" r:id="${esc(objectRid)}"/></w:object></w:r>`;
}

/**
 * 最小可用的 WMF 字节（placeable WMF：头 + 标准头 + SetWindowOrg + SetWindowExt + 矩形 + EOF）。
 * 可被自研 WMF 渲染器（src/lib/import/file-parsers/docx/wmf/）解析并渲染出含矩形与 viewBox 的 SVG，
 * 供测试真实渲染路径。
 */
export function minimalWmfBytes(): Uint8Array {
    // 以 16 位小端字为单位依次写入
    const words: number[] = [];
    // placeable 头（11 字 = 22 字节）：key(2) + hmf(1) + bbox(4) + inch(1) + reserved(2) + checksum(1)
    words.push(0xcdd7, 0x9ac6, 0, 0, 0, 400, 300, 576, 0, 0, 0);
    // 标准 metafile 头（9 字）：type、headerSize、version、size(2 字)、objects、maxRecord(2 字)、numOfParams
    words.push(1, 9, 0x0300, 0, 0, 0, 0x002c, 0, 0);
    // 记录格式：size(DWORD，占 2 字：低字在前) + func(1 字) + params
    // SetWindowOrg(0, 0)：size=5、func=0x020B
    words.push(5, 0, 0x020b, 0, 0);
    // SetWindowExt(400, 300)：size=5、func=0x020C
    words.push(5, 0, 0x020c, 400, 300);
    // 矩形：MoveTo(0,0)、四次 LineTo
    words.push(5, 0, 0x0214, 0, 0);
    words.push(5, 0, 0x0213, 400, 0);
    words.push(5, 0, 0x0213, 400, 300);
    words.push(5, 0, 0x0213, 0, 300);
    words.push(5, 0, 0x0213, 0, 0);
    // EOF：size=3、func=0
    words.push(3, 0, 0);
    const bytes = new Uint8Array(words.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < words.length; i++) view.setUint16(i * 2, words[i], true);
    return bytes;
}

/**
 * 简单分数 WMF 字节（MathType 风格：TA_UPDATECP + 横向分数线 + 分子/分母各一个字符）。
 * 可被自研 WMF 结构还原（wmf/latex.ts）高置信还原为 \frac{N}{D}。
 * numerator/denominator 为单字符（如 "5"、"9"）。
 */
export function simpleFractionWmfBytes(numerator = "5", denominator = "9"): Uint8Array {
    const words: number[] = [];
    /** 写一条记录：params 为 16 位字数组；奇数长度自动补 0 */
    const record = (func: number, params: number[]) => {
        const all = [...params];
        if (all.length % 2 === 1) all.push(0);
        words.push(3 + all.length, 0, func, ...all);
    };
    /** 把 ASCII 字符串追加为 16 位小端字（每字 2 字符） */
    const asciiWords = (text: string): number[] => {
        const bytes: number[] = [];
        for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i));
        if (bytes.length % 2 === 1) bytes.push(0);
        const out: number[] = [];
        for (let i = 0; i < bytes.length; i += 2) out.push(bytes[i] | (bytes[i + 1] << 8));
        return out;
    };
    /** 生成 CREATEFONTINDIRECT 的 LOGFONT 参数（25 字） */
    const logFont = (height: number, charSet: number, faceName: string): number[] => {
        const params = [height & 0xffff, 0, 0, 0, 400];
        params.push(0, (charSet & 0xff) << 8, 0, 0);
        const nameBytes: number[] = [];
        for (let i = 0; i < faceName.length && i < 31; i++) nameBytes.push(faceName.charCodeAt(i));
        nameBytes.push(0);
        while (nameBytes.length < 32) nameBytes.push(0);
        for (let i = 0; i < 32; i += 2) params.push(nameBytes[i] | (nameBytes[i + 1] << 8));
        return params;
    };
    /** ExtTextOut（TA_UPDATECP，dx 定位）：y/x 走 currentX/Y，count 字符，dx 逐字宽度 */
    const extTextOutUpdateCp = (text: string, dx: number) => {
        const params = [0, 0, text.length, 0, ...asciiWords(text)];
        for (let i = 0; i < text.length; i++) params.push(dx);
        record(0x0a32, params);
    };

    words.push(1, 9, 0x0300, 0, 0, 0, 0, 0, 0);   // 标准 metafile 头
    record(0x0103, [1]);                            // SetMapMode(MM_TEXT)
    record(0x0102, [1]);                            // SetBkMode(TRANSPARENT)
    record(0x012e, [0x0019]);                       // SetTextAlign(TA_UPDATECP | TA_BASELINE | TA_LEFT)
    record(0x020b, [0, 0]);                         // SetWindowOrg(0, 0)
    record(0x020c, [896, 320]);                     // SetWindowExt(y=896, x=320)
    record(0x02fb, logFont(-400, 0, "Times New Roman")); // CreateFontIndirect
    record(0x012d, [0]);                            // SelectObject(0)
    // 分数线：y=448, x 64→256
    record(0x0214, [448, 64]);                      // MoveTo(y=448, x=64)
    record(0x0213, [448, 256]);                     // LineTo(y=448, x=256)
    // 分子（基线 y=320）
    record(0x0214, [320, 160]);                     // MoveTo(y=320, x=160)
    extTextOutUpdateCp(numerator, 100);
    // 分母（基线 y=640）
    record(0x0214, [640, 160]);                     // MoveTo(y=640, x=160)
    extTextOutUpdateCp(denominator, 100);
    record(0, []);                                  // EOF
    const bytes = new Uint8Array(words.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < words.length; i++) view.setUint16(i * 2, words[i], true);
    return bytes;
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

/** 表格：rows 为单元格文字数组 */
export function tbl(rows: string[][]): string {
    const rowsXml = rows
        .map(
            (cells) =>
                `<w:tr>${cells.map((cell) => `<w:tc><w:p>${run(cell)}</w:p></w:tc>`).join("")}</w:tr>`
        )
        .join("");
    return `<w:tbl><w:tblPr/><w:tblGrid/>${rowsXml}</w:tbl>`;
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

/** numbering.xml 的 num 片段（含可选 lvlOverride） */
export function num(numId: string, abstractNumId: string, overrides: Array<{ ilvl: number; start?: number; numFmt?: string; lvlText?: string }> = []): string {
    const overridesXml = overrides
        .map((override) => {
            const parts: string[] = [];
            if (override.start !== undefined) parts.push(`<w:startOverride w:val="${override.start}"/>`);
            if (override.numFmt !== undefined || override.lvlText !== undefined) {
                const lvlParts: string[] = [];
                if (override.numFmt !== undefined) lvlParts.push(`<w:numFmt w:val="${override.numFmt}"/>`);
                if (override.lvlText !== undefined) lvlParts.push(`<w:lvlText w:val="${esc(override.lvlText)}"/>`);
                parts.push(`<w:lvl>${lvlParts.join("")}</w:lvl>`);
            }
            return `<w:lvlOverride w:ilvl="${override.ilvl}">${parts.join("")}</w:lvlOverride>`;
        })
        .join("");
    return `<w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractNumId}"/>${overridesXml}</w:num>`;
}

export interface MinimalDocxOptions {
    /** word/document.xml 的 w:body 子元素 XML（段落、表格等） */
    body: string;
    /** numbering.xml 的 w:abstractNum 与 w:num 片段（可选部件） */
    numbering?: string;
    /** styles.xml 的 w:style 片段（可选部件） */
    styles?: string;
    /** word/_rels/document.xml.rels 的 Relationship 片段（可选部件），如 <Relationship Id="rId4" Target="media/image1.png"/> */
    rels?: string;
    /** 额外 zip 条目（如 word/media/image1.png），key 为完整文件名 */
    extraFiles?: Record<string, Uint8Array>;
}

/** 构造最小 docx 的 ArrayBuffer（供 parseDocx 直接消费） */
export function makeDocxBuffer(options: MinimalDocxOptions): ArrayBuffer {
    const files: Record<string, Uint8Array> = {
        "[Content_Types].xml": new TextEncoder().encode(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
        ),
        "word/document.xml": new TextEncoder().encode(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body>${options.body}</w:body></w:document>`
        ),
    };
    if (options.numbering !== undefined) {
        files["word/numbering.xml"] = new TextEncoder().encode(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${options.numbering}</w:numbering>`
        );
    }
    if (options.styles !== undefined) {
        files["word/styles.xml"] = new TextEncoder().encode(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${options.styles}</w:styles>`
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
    const zipped = zipSync(files, { level: 0 });
    // zipSync 返回 Uint8Array；包一层 ArrayBuffer 视图保证类型一致
    return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

/** 旧版 .doc（OLE2）文件头构造（前 8 字节） */
export function makeLegacyDocBuffer(): ArrayBuffer {
    const bytes = new Uint8Array(16);
    bytes[0] = 0xd0;
    bytes[1] = 0xcf;
    bytes[2] = 0x11;
    bytes[3] = 0xe0;
    for (let i = 4; i < 16; i++) bytes[i] = i;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
