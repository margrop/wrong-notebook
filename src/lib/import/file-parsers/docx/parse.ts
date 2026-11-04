/**
 * docx 题库文件解析入口。
 *
 * 流程：
 * 1. 解压 zip 并读取 word/document.xml、word/numbering.xml、word/styles.xml（docx-xml.ts）
 * 2. 按文档顺序提取段落与表格行，给带自动编号的段落加编号前缀（text.ts + numbering.ts）
 * 3. 拼接全文送 splitQuestionText 分题；不足两题时整篇作为一题并给出 SINGLE_QUESTION 警告
 * 4. 把 SplitTextQuestion 转为 StructuredQuestion 后调用 parseQuestionFile 复用规范化与上限校验
 *
 * 上标输出 ^{…}（纯数字用 ^2 简写），下标输出 _{…}（同规则）；
 * 公式输出占位符 [公式]（OMML 公式与 OLE 公式对象的 WMF 预览图可高置信还原时输出 $…$ LaTeX）；
 * 图片默认真实提取：w:drawing（a:blip r:embed）、w:pict（v:imagedata r:id）与
 * run 内直接的 w:object（v:imagedata r:id，MathType/公式编辑器等 OLE 对象）按 rId 查找
 * word/media/* 文件；png/jpeg/gif/webp/bmp 转 data URL；WMF/EMF 以「待渲染图片」挂到题目上——
 * data:image/wmf|emf;base64,… 的 dataUrl，渲染目标尺寸放在 alt 中（metafile.ts），
 * 由浏览器导入流程在使用前渲染为 PNG 再参与合成；正文中以 [图片] 占位。
 * OLE 公式对象的 WMF 预览图会先尝试结构还原为 LaTeX（wmf/latex.ts），高置信时在
 * 正文原位置插入 $latex$ 且不再作为图片；低置信或失败时保持 [公式] 占位 + 按图片保留。
 * tiff 等不支持的格式跳过并计入 IMAGE_UNSUPPORTED 警告。
 * 正文中用唯一占位符 ⟦IMG:N⟧ 标记位置，分题后替换为「[图片]」并挂到对应题的 images。
 *
 * 删除线、隐藏文字跳过；修订保留插入、跳过删除。
 * 页眉页脚、批注、脚注不处理。
 * 旧版 .doc 二进制返回 LEGACY_DOC_NOT_SUPPORTED；损坏的 zip 或非 docx 返回 INVALID_DOCX。
 *
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
import type { QuestionParseResult } from "@/lib/question-format/types";
import { parseQuestionFile, withoutExchangeFormatWarnings } from "@/lib/question-format/parse";
import type { SplitTextQuestion } from "@/lib/question-split/text";
import { splitQuestionText } from "@/lib/question-split/text";
import type { TextSplitOptions } from "@/lib/question-split/text";
import { isLegacyDocFile, loadDocxParts } from "@/lib/import/file-parsers/docx/docx-xml";
import { NumberingResolver } from "@/lib/import/file-parsers/docx/numbering";
import type { DocxInlineHandlers, DocxContext, DocxMathCollector } from "@/lib/import/file-parsers/docx/text";
import { DEFAULT_MATH_PLACEHOLDER, paragraphText, tableRowText } from "@/lib/import/file-parsers/docx/text";
import { ommlToLatex } from "@/lib/import/file-parsers/docx/omml";
import { wmfBytesToLatex } from "@/lib/import/file-parsers/docx/wmf";
import {
    computeMetafilePixelSize,
    encodeMetafileAlt,
    encodeMetafileDataUrl,
    ptToPx,
} from "@/lib/import/file-parsers/docx/metafile";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const VML = "urn:schemas-microsoft-com:vml";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";

export const WARNING_SINGLE_QUESTION = "SINGLE_QUESTION";

/** 把 ignored 内容数量放入 warnings：IGNORED_PARAGRAPHS:N */
function ignoredWarning(count: number): string {
    return `IGNORED_PARAGRAPHS:${count}`;
}

const MATH_UNSUPPORTED_WARNING = "MATH_UNSUPPORTED";
const IMAGE_UNSUPPORTED_WARNING = "IMAGE_UNSUPPORTED";
/** MATH_UNSUPPORTED 中最多列出的元素名个数 */
const MAX_UNSUPPORTED_LIST = 10;

/** 图片占位符前缀：正文中用 ⟦IMG:N⟧ 标记第 N 张图片的位置 */
const IMAGE_PLACEHOLDER_PREFIX = "⟦IMG:";
/** 图片占位符后缀 */
const IMAGE_PLACEHOLDER_SUFFIX = "⟧";
/** 正文分题后 ⟦IMG:N⟧ 替换的占位文本（普通图片） */
const IMAGE_DISPLAY_TEXT = "[图片]";
/** OLE 公式对象（w:object/w:pict 内 o:OLEObject）替换的占位文本 */
const EQUATION_DISPLAY_TEXT = "[公式]";

/** 浏览器可渲染的图片格式 → MIME 映射 */
const SUPPORTED_IMAGE_FORMATS: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
};

/** 待渲染的 metafile 格式（浏览器导入流程会渲染为 PNG 后再合成） */
const METAFILE_EXTENSIONS = new Set(["emf", "wmf"]);

/** 不支持的图片格式（浏览器无法渲染，跳过） */
const UNSUPPORTED_IMAGE_EXTENSIONS = new Set(["tiff", "tif", "svg", "ico", "pcx", "tga"]);

/** 默认公式处理：m:oMath 输出 $…$，m:oMathPara 输出独立一行 $$…$$；失败退回 [公式] */
function defaultMathHandler(collector: DocxMathCollector) {
    return (element: Element): string | undefined => {
        const { latex, unsupported } = ommlToLatex(element);
        for (const name of unsupported) collector.unsupported.add(name);
        const trimmed = latex.trim();
        if (!trimmed) return DEFAULT_MATH_PLACEHOLDER;
        const isBlock = element.localName === "oMathPara";
        return isBlock ? `\n$$\n${trimmed}\n$$\n` : `$${trimmed}$`;
    };
}

/** 图片提取收集器：跨段落汇总提取的图片与不支持格式计数 */
export interface ImageCollector {
    /** 按出现顺序收集的图片（data URL；metafile 附渲染目标尺寸的 alt） */
    images: Array<{ dataUrl: string; alt?: string; oleEquation?: boolean }>;
    /** 不支持的格式扩展名（去重） */
    unsupported: Set<string>;
    /** OLE 公式对象成功还原为 LaTeX 的数量 */
    oleLatexCount: number;
}

/** 从 w:drawing / w:pict / w:object 元素中提取图片 rId（a:blip r:embed 或 v:imagedata r:id） */
function extractImageRid(element: Element): string | null {
    // w:drawing → a:blip r:embed
    const blips = element.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "blip");
    for (const blip of Array.from(blips)) {
        const embed = blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed");
        if (embed) return embed;
    }
    // w:pict → v:imagedata r:id
    const imagedatas = element.getElementsByTagNameNS("urn:schemas-microsoft-com:vml", "imagedata");
    for (const imagedata of Array.from(imagedatas)) {
        const rid = imagedata.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
        if (rid) return rid;
    }
    return null;
}

/** 按 rId 查找 word/media/* 文件并提取为图片（data URL；metafile 附渲染目标尺寸的 alt） */
function extractImageDataUrl(element: Element, ctx: DocxContext, collector: ImageCollector): { dataUrl: string; alt?: string } | null {
    const rid = extractImageRid(element);
    if (!rid) return null;
    const target = ctx.relationships[rid];
    if (!target) return null;
    // target 如 "media/image1.png"，files 的 key 是全小写路径
    const fileKey = `word/${target}`.toLowerCase();
    const bytes = ctx.files[fileKey];
    if (!bytes) return null;
    // 从扩展名判断格式
    const ext = fileKey.split(".").pop()?.toLowerCase() ?? "";
    if (METAFILE_EXTENSIONS.has(ext)) {
        // WMF/EMF：以「待渲染图片」挂到题目上（data:image/wmf|emf;base64,…），
        // 由浏览器导入流程渲染为 PNG 后再参与合成；渲染目标尺寸（图片显示尺寸换算像素、
        // 公式小图已放大）放在 alt 的结构化前缀中（metafile.ts）。
        const format = ext === "wmf" ? "wmf" : "emf";
        const display = extractImageDisplaySize(element);
        const targetSize = computeMetafilePixelSize(display.width, display.height);
        return { dataUrl: encodeMetafileDataUrl(bytes, format), alt: encodeMetafileAlt(targetSize.width, targetSize.height) };
    }
    if (UNSUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
        collector.unsupported.add(ext);
        return null;
    }
    const mime = SUPPORTED_IMAGE_FORMATS[ext];
    if (!mime) {
        collector.unsupported.add(ext || "unknown");
        return null;
    }
    // 转 base64 data URL
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode(...chunk);
    }
    const base64 = btoa(binary);
    return { dataUrl: `data:${mime};base64,${base64}` };
}

/** 提取图片在 Word 中的显示尺寸并换算为像素（用于 metafile 渲染目标；失败用默认值） */
function extractImageDisplaySize(element: Element): { width: number; height: number } {
    // w:drawing → wp:extent cx/cy（EMU：1pt = 12700 EMU）
    const extent = element.getElementsByTagNameNS(WP, "extent")[0];
    if (extent) {
        const cx = Number.parseInt(extent.getAttribute("cx") ?? "", 10);
        const cy = Number.parseInt(extent.getAttribute("cy") ?? "", 10);
        if (Number.isFinite(cx) && cx > 0 && Number.isFinite(cy) && cy > 0) {
            return { width: cx / 12700, height: cy / 12700 };
        }
    }
    // w:pict → v:shape style（如 "width:100pt;height:50pt"）
    const shape = element.getElementsByTagNameNS(VML, "shape")[0];
    const style = shape?.getAttribute("style") ?? "";
    const width = parseVmlLength(style, "width");
    const height = parseVmlLength(style, "height");
    return { width: width ?? 300, height: height ?? 225 };
}

/** 解析 VML style 中的长度（支持 pt/px/in/cm/mm/pc，纯计算） */
function parseVmlLength(style: string, name: string): number | null {
    const match = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)(pt|px|in|cm|mm|pc)?`, "i").exec(style);
    if (!match) return null;
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    switch ((match[2] ?? "pt").toLowerCase()) {
        case "px": return value;
        case "in": return ptToPx(value * 72);
        case "cm": return ptToPx((value / 2.54) * 72);
        case "mm": return ptToPx((value / 25.4) * 72);
        case "pc": return ptToPx(value * 12);
        default: return ptToPx(value);
    }
}

/** 默认图片处理：提取真实图片并记录是否 OLE 公式对象，正文中插入唯一占位符 ⟦IMG:N⟧；失败退回默认占位 */
function defaultImageHandler(collector: ImageCollector) {
    return (element: Element, ctx: DocxContext): string | undefined => {
        // OLE 公式对象：先尝试 WMF 结构还原为 LaTeX
        const rid = extractImageRid(element);
        if (rid && isOleEquationElement(element)) {
            const target = ctx.relationships[rid];
            if (target) {
                const fileKey = `word/${target}`.toLowerCase();
                const bytes = ctx.files[fileKey];
                if (bytes && fileKey.endsWith(".wmf")) {
                    const { latex, confidence } = wmfBytesToLatex(bytes);
                    if (confidence === "high" && latex) {
                        collector.oleLatexCount += 1;
                        return `$${latex}$`;
                    }
                }
            }
        }
        const image = extractImageDataUrl(element, ctx, collector);
        if (image === null) {
            // 提取失败或不支持：退回默认占位符
            return undefined;
        }
        const index = collector.images.length;
        collector.images.push({ ...image, oleEquation: isOleEquationElement(element) });
        return `${IMAGE_PLACEHOLDER_PREFIX}${index}${IMAGE_PLACEHOLDER_SUFFIX}`;
    };
}

/** 判断元素是否为 OLE 公式对象（w:object/w:pict 内 OLE 公式：ProgID 含 Equation，或 v:shapetype id 为公式专用 _x0000_tole_*） */
function isOleEquationElement(element: Element): boolean {
    const objects = element.localName === "object" && element.namespaceURI === W
        ? [element]
        : Array.from(element.getElementsByTagNameNS(W, "object"));
    for (const object of objects) {
        for (const objectElement of Array.from(object.getElementsByTagName("*"))) {
            const progid = objectElement.getAttribute("ProgID");
            if (progid && /Equation/i.test(progid)) return true;
        }
        for (const shapetype of Array.from(object.getElementsByTagNameNS(VML, "shapetype"))) {
            const id = shapetype.getAttribute("id") ?? "";
            if (/^_x0000_tole_/i.test(id)) return true;
        }
    }
    return false;
}

/** 按文档顺序提取全文行：段落加自动编号前缀，表格行用制表符连接单元格 */
function extractLines(document: Document, resolver: NumberingResolver, handlers: DocxInlineHandlers, docxContext: DocxContext): string[] {
    const body = document.getElementsByTagNameNS(W, "body")[0];
    if (!body) return [];
    const lines: string[] = [];
    const walk = (node: Node) => {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType !== child.ELEMENT_NODE) continue;
            const element = child as Element;
            if (element.namespaceURI !== W) continue;
            if (element.localName === "p") {
                const text = paragraphText(element, handlers, docxContext);
                const numPr = resolver.resolveNumPr(element);
                const numbering = numPr ? resolver.paragraphNumber(numPr[0], numPr[1]) : null;
                const trimmed = numbering?.trim() ?? "";
                // Word 中自动编号与正文之间本有制表符。全角分隔符（「一、」「1．」「（三）」）直接拼接；
                // 半角分隔符（「1.」「1)」「1:」）与无分隔符的编号（如 ①）补一个空格——否则「8.」与以数字开头的
                // 正文（如「2008年」）连成「8.2008」，会被当作小数而断开题号序列
                const fullWidthSeparator = /[、．。：）)]$/.test(trimmed) && !/[.):]$/.test(trimmed);
                const prefix = trimmed ? (fullWidthSeparator ? trimmed : `${trimmed} `) : "";
                lines.push(`${prefix}${text}`);
            } else if (element.localName === "tbl") {
                for (const row of Array.from(element.getElementsByTagNameNS(W, "tr"))) {
                    const rowText = tableRowText(row, handlers, docxContext);
                    if (rowText.trim()) lines.push(rowText);
                }
            } else if (element.localName === "sdt") {
                walk(element);
            }
        }
    };
    walk(body);
    return lines;
}

/** 把题目文字中的 ⟦IMG:N⟧ 占位符替换为 [图片]，并收集该题的图片索引 */
/**
 * 把题目文字中的 ⟦IMG:N⟧ 占位符替换为对应占位文本（OLE 公式对象 → [公式]，其余 → [图片]），
 * 并收集该题的图片索引
 */
function replaceImagePlaceholders(
    text: string,
    images: Array<{ dataUrl: string; alt?: string; oleEquation?: boolean }>,
): { text: string; usedIndexes: number[] } {
    const usedIndexes: number[] = [];
    const replaced = text.replace(/⟦IMG:(\d+)⟧/g, (_match, idxStr: string) => {
        const idx = parseInt(idxStr, 10);
        if (idx >= 0 && idx < images.length && !usedIndexes.includes(idx)) {
            usedIndexes.push(idx);
        }
        const image = idx >= 0 && idx < images.length ? images[idx] : undefined;
        return image?.oleEquation ? EQUATION_DISPLAY_TEXT : IMAGE_DISPLAY_TEXT;
    });
    return { text: replaced, usedIndexes };
}

/** 给 SplitTextQuestion 的 text/material/answer/analysis 替换占位符并附加 images */
function attachImagesToQuestion(
    question: SplitTextQuestion,
    allImages: Array<{ dataUrl: string; alt?: string; oleEquation?: boolean }>,
): SplitTextQuestion {
    const allTexts = [question.text, question.material, question.answer, question.analysis];
    const allUsed: number[] = [];
    const replacedTexts = allTexts.map((t) => {
        if (!t) return t;
        const { text, usedIndexes } = replaceImagePlaceholders(t, allImages);
        allUsed.push(...usedIndexes);
        return text;
    });
    // 按出现顺序去重
    const uniqueUsed = Array.from(new Set(allUsed)).sort((a, b) => a - b);
    const questionImages = uniqueUsed
        .filter((idx) => idx < allImages.length)
        .map((idx) => allImages[idx]);
    return {
        ...question,
        text: replacedTexts[0] ?? question.text,
        material: replacedTexts[1] ?? question.material,
        answer: replacedTexts[2] ?? question.answer,
        analysis: replacedTexts[3] ?? question.analysis,
        ...(questionImages.length > 0 ? { images: questionImages } : {}),
    };
}

/** SplitTextQuestion → parseQuestionFile 输入（复用规范化与上限校验）；images 由调用方在解析后挂回 */
function toStructuredInput(question: SplitTextQuestion): Record<string, unknown> {
    const record: Record<string, unknown> = { text: question.text };
    if (question.material) record.material = question.material;
    if (question.section) record.section = question.section;
    if (question.label) record.label = question.label;
    if (question.answer) record.answer = question.answer;
    if (question.analysis) record.analysis = question.analysis;
    if (question.knowledgePoints?.length) record.knowledgePoints = question.knowledgePoints;
    if (question.difficultyStars !== null && question.difficultyStars !== undefined) record.difficultyStars = question.difficultyStars;
    if (question.wrongAnswer) record.wrongAnswer = question.wrongAnswer;
    if (question.questionType) record.questionType = question.questionType;
    return record;
}

/**
 * 解析 docx 题库文件。
 * 旧版 .doc（文件头 D0 CF 11 E0）返回 LEGACY_DOC_NOT_SUPPORTED；
 * 损坏的 zip 或非 docx 返回 INVALID_DOCX（index 均为 -1）。
 *
 * Word 自带公式（OMML）默认转为 LaTeX：m:oMath 输出 $…$，m:oMathPara 输出独立一行 $$…$$；
 * MathType 等 OLE 公式对象不是 OMML，在 docx 中表现为 w:object/w:pict 内嵌图片。
 * 其 WMF 预览图会先尝试结构还原（分数、上下标、常见符号）：
 * 高置信时在正文原位置插入 $latex$ 且不再作为图片；低置信或失败时按图片提取、
 * 正文输出「[公式]」占位并计入 OLE_EQUATION_IMAGE 警告。
 *
 * 图片默认真实提取：w:drawing（a:blip r:embed）、w:pict（v:imagedata r:id）与 run 内直接的
 * w:object（v:imagedata r:id）按 rId 查找 word/media/* 文件；
 * png/jpeg/gif/webp/bmp 转 data URL；WMF/EMF 以「待渲染图片」
 * 挂到题目 images（data:image/wmf|emf;base64,…，渲染目标尺寸在 alt 中），由浏览器
 * 导入流程渲染为 PNG 后参与合成；tiff 等浏览器无法渲染的格式跳过并计入
 * IMAGE_UNSUPPORTED 警告。正文中用 ⟦IMG:N⟧ 占位符标记位置，
 * 分题后替换为「[公式]」（OLE 公式对象，低置信时）或「[图片]」并把对应图片挂到该题的
 * images 上；OLE 公式对象高置信还原为 LaTeX 时正文直接为 $latex$，不产生图片。
 */
export async function parseDocx(
    buffer: ArrayBuffer,
    handlers: DocxInlineHandlers = {},
    splitOptions?: TextSplitOptions,
): Promise<QuestionParseResult> {
    const bytes = new Uint8Array(buffer);
    if (isLegacyDocFile(bytes)) {
        return { questions: [], errors: [{ index: -1, reason: "LEGACY_DOC_NOT_SUPPORTED" }], warnings: [] };
    }
    let parts: ReturnType<typeof loadDocxParts>;
    try {
        parts = loadDocxParts(bytes);
    } catch {
        return { questions: [], errors: [{ index: -1, reason: "INVALID_DOCX" }], warnings: [] };
    }

    const mathCollector: DocxMathCollector = { unsupported: new Set(), oleCount: 0 };
    const imageCollector: ImageCollector = { images: [], unsupported: new Set(), oleLatexCount: 0 };    const defaultImage = defaultImageHandler(imageCollector);
    const mergedImage = handlers.image
        ? (element: Element, ctx: DocxContext) => handlers.image!(element, ctx) ?? defaultImage(element, ctx)
        : defaultImage;
    const mergedHandlers: DocxInlineHandlers = { math: defaultMathHandler(mathCollector), ...handlers, image: mergedImage };
    const docxContext: DocxContext = { relationships: parts.relationships, files: parts.files, mathCollector };
    const resolver = new NumberingResolver(parts.numbering, parts.styles);
    const lines = extractLines(parts.document, resolver, mergedHandlers, docxContext);
    // 用空行连接段落，还原段落感；splitQuestionText 会再归一化
    const fullText = lines.join("\n");

    const split = splitQuestionText(fullText, splitOptions);
    const warnings: string[] = [];
    if (split.ignored.length > 0) warnings.push(ignoredWarning(split.ignored.length));
    if (!split.detected && split.questions.length === 1) warnings.push(WARNING_SINGLE_QUESTION);
    if (mathCollector.unsupported.size > 0) {
        const listed = Array.from(mathCollector.unsupported).slice(0, MAX_UNSUPPORTED_LIST).join(",");
        warnings.push(`${MATH_UNSUPPORTED_WARNING}:${listed}`);
    }
    if (mathCollector.oleCount > 0) {
        const oleImageCount = mathCollector.oleCount - imageCollector.oleLatexCount;
        if (imageCollector.oleLatexCount > 0) {
            warnings.push(`OLE_EQUATION_LATEX:${imageCollector.oleLatexCount}`);
        }
        if (oleImageCount > 0) {
            warnings.push(`OLE_EQUATION_IMAGE:${oleImageCount}`);
        }
    }
    if (imageCollector.unsupported.size > 0) {
        const listed = Array.from(imageCollector.unsupported).slice(0, MAX_UNSUPPORTED_LIST).join(",");
        warnings.push(`${IMAGE_UNSUPPORTED_WARNING}:${listed}`);
    }

    // 替换图片占位符并挂接图片（含 WMF/EMF 待渲染图片）
    const questionsWithImages = split.questions.map((q) => attachImagesToQuestion(q, imageCollector.images));

    const parsed = parseQuestionFile(questionsWithImages.map(toStructuredInput));
    // docx 提取的图片（含待渲染的 WMF/EMF）绕过 parseQuestionFile 的位图 data URL 校验，
    // 按占位符归属直接挂回对应题；被 parseQuestionFile 丢弃的题不再挂图。
    const imagesByQuestion = new Map<SplitTextQuestion, Array<{ dataUrl: string; alt?: string; oleEquation?: boolean }>>();
    for (const q of questionsWithImages) {
        const images = (q as unknown as { images?: Array<{ dataUrl: string; alt?: string; oleEquation?: boolean }> }).images;
        if (images?.length) imagesByQuestion.set(q, images);
    }
    const resultQuestions = parsed.questions.map((question, index) => {
        const source = questionsWithImages[index];
        const images = source ? imagesByQuestion.get(source) : undefined;
        // 挂回时去掉内部分类字段（oleEquation），只保留 dataUrl/alt
        return images?.length ? { ...question, images: images.map(({ dataUrl, alt }) => (alt === undefined ? { dataUrl } : { dataUrl, alt })) } : question;
    });
    return {
        questions: resultQuestions,
        errors: parsed.errors,
        warnings: [...warnings, ...withoutExchangeFormatWarnings(parsed.warnings)],
    };
}
