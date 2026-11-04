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
 * 公式输出占位符 [公式]（可通过 handlers.math 扩展）；
 * 图片默认真实提取：w:drawing（a:blip r:embed）与 w:pict（v:imagedata r:id）按 rId 查找
 * word/media/* 文件，png/jpeg/gif/webp/bmp 转 data URL（GIF/BMP 由后续压缩步骤转 JPEG），
 * emf/wmf/tiff 等不支持的格式跳过并计入 IMAGE_UNSUPPORTED 警告。
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

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export const WARNING_SINGLE_QUESTION = "SINGLE_QUESTION";

/** 把 ignored 内容数量放入 warnings：IGNORED_PARAGRAPHS:N */
function ignoredWarning(count: number): string {
    return `IGNORED_PARAGRAPHS:${count}`;
}

const MATH_UNSUPPORTED_WARNING = "MATH_UNSUPPORTED";
const OLE_EQUATION_WARNING = "OLE_EQUATION";
const IMAGE_UNSUPPORTED_WARNING = "IMAGE_UNSUPPORTED";
/** MATH_UNSUPPORTED 中最多列出的元素名个数 */
const MAX_UNSUPPORTED_LIST = 10;

/** 图片占位符前缀：正文中用 ⟦IMG:N⟧ 标记第 N 张图片的位置 */
const IMAGE_PLACEHOLDER_PREFIX = "⟦IMG:";
/** 图片占位符后缀 */
const IMAGE_PLACEHOLDER_SUFFIX = "⟧";
/** 正文分题后占位符替换为「[图片]」 */
const IMAGE_DISPLAY_TEXT = "[图片]";

/** 浏览器可渲染的图片格式 → MIME 映射 */
const SUPPORTED_IMAGE_FORMATS: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
};

/** 不支持的图片格式（浏览器无法渲染，跳过） */
const UNSUPPORTED_IMAGE_EXTENSIONS = new Set(["emf", "wmf", "tiff", "tif", "svg", "ico", "pcx", "tga"]);

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
    /** 按出现顺序收集的 data URL */
    images: string[];
    /** 不支持的格式扩展名（去重） */
    unsupported: Set<string>;
}

/** 从 w:drawing 或 w:pict 元素中提取 rId（a:blip r:embed 或 v:imagedata r:id） */
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

/** 按 rId 查找 word/media/* 文件并转为 data URL */
function extractImageDataUrl(element: Element, ctx: DocxContext, collector: ImageCollector): string | null {
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
    return `data:${mime};base64,${base64}`;
}

/** 默认图片处理：提取真实图片，正文中插入唯一占位符 ⟦IMG:N⟧；失败退回 [图片] */
function defaultImageHandler(collector: ImageCollector) {
    return (element: Element, ctx: DocxContext): string | undefined => {
        const dataUrl = extractImageDataUrl(element, ctx, collector);
        if (dataUrl === null) {
            // 提取失败或不支持：退回默认占位符
            return undefined;
        }
        const index = collector.images.length;
        collector.images.push(dataUrl);
        return `${IMAGE_PLACEHOLDER_PREFIX}${index}${IMAGE_PLACEHOLDER_SUFFIX}`;
    };
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
                // 编号文本（如「1.」「一、」「（三）」）已含分隔符，直接拼接；
                // 无分隔符的（如 ①）补一个空格，便于分题识别题号
                const hasSeparator = /[.、．。:：)））]\s*$/.test(trimmed);
                const prefix = trimmed ? (hasSeparator ? trimmed : `${trimmed} `) : "";
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
function replaceImagePlaceholders(text: string, images: string[]): { text: string; usedIndexes: number[] } {
    const usedIndexes: number[] = [];
    const replaced = text.replace(/⟦IMG:(\d+)⟧/g, (_match, idxStr: string) => {
        const idx = parseInt(idxStr, 10);
        if (idx >= 0 && idx < images.length && !usedIndexes.includes(idx)) {
            usedIndexes.push(idx);
        }
        return IMAGE_DISPLAY_TEXT;
    });
    return { text: replaced, usedIndexes };
}

/** 给 SplitTextQuestion 的 text/material/answer/analysis 替换占位符并附加 images */
function attachImagesToQuestion(question: SplitTextQuestion, allImages: string[]): SplitTextQuestion {
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
        .map((idx) => ({ dataUrl: allImages[idx] }));
    return {
        ...question,
        text: replacedTexts[0] ?? question.text,
        material: replacedTexts[1] ?? question.material,
        answer: replacedTexts[2] ?? question.answer,
        analysis: replacedTexts[3] ?? question.analysis,
        ...(questionImages.length > 0 ? { images: questionImages } : {}),
    };
}

/** SplitTextQuestion → parseQuestionFile 输入（复用规范化与上限校验） */
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
    // images 字段附加（parseQuestionFile 会校验 data URL 格式）
    const images = (question as unknown as { images?: Array<{ dataUrl: string }> }).images;
    if (images?.length) record.images = images;
    return record;
}

/**
 * 解析 docx 题库文件。
 * 旧版 .doc（文件头 D0 CF 11 E0）返回 LEGACY_DOC_NOT_SUPPORTED；
 * 损坏的 zip 或非 docx 返回 INVALID_DOCX（index 均为 -1）。
 *
 * Word 自带公式（OMML）默认转为 LaTeX：m:oMath 输出 $…$，m:oMathPara 输出独立一行 $$…$$；
 * MathType 等 OLE 公式对象不是 OMML，在 docx 中表现为图片，仍按图片占位并计数。
 *
 * 图片默认真实提取：w:drawing（a:blip r:embed）与 w:pict（v:imagedata r:id）按 rId 查找
 * word/media/* 文件；png/jpeg/gif/webp/bmp 转 data URL，emf/wmf/tiff 等浏览器无法渲染的
 * 格式跳过并计入 IMAGE_UNSUPPORTED 警告。正文中用 ⟦IMG:N⟧ 占位符标记位置，
 * 分题后替换为「[图片]」并把对应图片挂到该题的 images 上。
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
    const imageCollector: ImageCollector = { images: [], unsupported: new Set() };
    const defaultImage = defaultImageHandler(imageCollector);
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
        warnings.push(`${OLE_EQUATION_WARNING}:${mathCollector.oleCount}`);
    }
    if (imageCollector.unsupported.size > 0) {
        const listed = Array.from(imageCollector.unsupported).slice(0, MAX_UNSUPPORTED_LIST).join(",");
        warnings.push(`${IMAGE_UNSUPPORTED_WARNING}:${listed}`);
    }

    // 替换图片占位符并挂接图片
    const questionsWithImages = split.questions.map((q) => attachImagesToQuestion(q, imageCollector.images));

    const result = parseQuestionFile(questionsWithImages.map(toStructuredInput));
    return {
        questions: result.questions,
        errors: result.errors,
        warnings: [...warnings, ...withoutExchangeFormatWarnings(result.warnings)],
    };
}
