/**
 * StructuredQuestion[] → .docx 导出转换器（docx 库）。
 * 生成便于打印成试卷的 Word 文档：
 * - 文档标题（可自定义，默认「错题导出 yyyy-MM-dd」）；
 * - 按 section（无则按题型显示名，再无则不分组）分组，组标题为「第X大题 …」；
 * - 题号连续（1. 2. …），题干保留换行；
 * - 可选「包含原图」：images[] 的 data URL 解码后按宽度上限等比缩放插入；
 * - 可选「包含答案与解析」（默认开启）：统一放在文末「参考答案」部分，
 *   按「N. 答案【解析：…】」格式书写，可被导入端 fillAnswersFromTail 按题号回填；
 * - LaTeX 公式（$…$、$$…$$）以原文保留；figureSvg 不导出。
 *
 * Markdown 的粗体/斜体标记（**…**、*…*）按原样保留为文本，不做转换。
 *
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
import {
    AlignmentType,
    HeadingLevel,
    ImageRun,
    Paragraph,
    TextRun,
} from "docx";
import type { StructuredQuestion } from "@/lib/question-format/types";
import { normalizeQuestionType, QUESTION_TYPE_NAMES_ZH } from "@/lib/question/question-type";

/** Word 导出选项 */
export interface DocxExportOptions {
    /** 文档标题；缺省为「错题导出 yyyy-MM-dd」 */
    title?: string;
    /** 是否包含答案与解析（默认 true），放在文末「参考答案」部分 */
    includeAnswers?: boolean;
    /** 是否包含原图（默认 false） */
    includeImages?: boolean;
    /** 图片显示宽度上限（像素），超出等比缩放（默认 480） */
    maxImageWidthPx?: number;
}

/** 图片字节 + 从头部读出的像素尺寸 */
export interface ImageBytesWithSize {
    bytes: Uint8Array;
    /** 图片类型：目前 data URL 只允许 png / jpeg / webp；docx 对 webp 支持差，按 png 写入 */
    type: "png" | "jpg";
    widthPx: number;
    heightPx: number;
}

/** 默认图片宽度上限（像素）：A4 纵向正文宽度约 480px（96dpi 下 6.3 英寸） */
const DEFAULT_MAX_IMAGE_WIDTH_PX = 480;

const DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/;

/** data URL 解码为图片字节；不支持的类型返回 null */
export function dataUrlToImageBytes(dataUrl: string): ImageBytesWithSize | null {
    const match = dataUrl.match(DATA_URL_PATTERN);
    if (!match) return null;
    // 浏览器与服务端（Node 18+）均提供全局 atob
    let bytes: Uint8Array;
    try {
        const binary = atob(match[2]);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch {
        return null;
    }
    const size = readImageSize(bytes);
    if (!size) return null;
    // docx 的 ImageRun 不支持 webp，按扩展名写入会损坏文件；webp 直接跳过
    const mime = match[1].toLowerCase();
    if (mime === "webp") return null;
    return { bytes, type: mime === "png" ? "png" : "jpg", widthPx: size.width, heightPx: size.height };
}

/**
 * 从 PNG / JPEG 文件头读取像素尺寸（纯函数，不依赖图片解码库）。
 * PNG: IHDR 宽高（大端，偏移 16/20）；JPEG: 逐段扫描 SOF0~SOF15。
 */
export function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
    // PNG: 8 字节签名 + 4 长度 + 4 「IHDR」+ 宽高各 4 字节（大端）
    if (bytes.length >= 24
        && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const width = view.getUint32(16, false);
        const height = view.getUint32(20, false);
        if (width > 0 && height > 0) return { width, height };
        return null;
    }
    // JPEG: FF D8 开头，扫描标记段
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        let offset = 2;
        while (offset + 9 < bytes.length) {
            if (bytes[offset] !== 0xff) {
                offset++;
                continue;
            }
            const marker = bytes[offset + 1];
            // SOF0~SOF15（不含 DHT/DAC/RST 等）
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                const height = view.getUint16(offset + 5, false);
                const width = view.getUint16(offset + 7, false);
                if (width > 0 && height > 0) return { width, height };
                return null;
            }
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const segmentLength = view.getUint16(offset + 2, false);
            if (segmentLength < 2) return null;
            offset += 2 + segmentLength;
        }
        return null;
    }
    return null;
}

/** 等比缩放：宽超出上限时按比例缩小，高不足 1px 时置 1 */
export function scaleToMaxWidth(width: number, height: number, maxWidth: number): { width: number; height: number } {
    if (width <= maxWidth) return { width, height };
    const scaledHeight = Math.max(1, Math.round((height * maxWidth) / width));
    return { width: maxWidth, height: scaledHeight };
}

/** 阿拉伯数字 → 中文数字（1~9999，覆盖大题分组序号） */
export function toChineseNumber(value: number): string {
    const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    if (value <= 0) return String(value);
    if (value < 10) return digits[value];
    if (value < 100) {
        const tens = Math.floor(value / 10);
        const ones = value % 10;
        return (tens > 1 ? digits[tens] : "") + "十" + (ones > 0 ? digits[ones] : "");
    }
    if (value < 1000) {
        const hundreds = Math.floor(value / 100);
        const rest = value % 100;
        if (rest === 0) return digits[hundreds] + "百";
        // 余数 1~19 读作「一百一十」「一百零五」需补「一」/「零」前缀，
        // 其余（如 120 → 「一百二十」）直接拼接
        if (rest < 10) return digits[hundreds] + "百零" + digits[rest];
        if (rest < 20) return digits[hundreds] + "百一" + toChineseNumber(rest);
        return digits[hundreds] + "百" + toChineseNumber(rest);
    }
    const thousands = Math.floor(value / 1000);
    const rest = value % 1000;
    return digits[thousands] + "千" + (rest > 0 ? toChineseNumber(rest) : "");
}

/** 组标题：section/题型名 已以「第X大题/部分/节」等开头时原样使用，否则补「第X大题 」前缀 */
function groupHeading(index: number, name: string): string {
    if (/^(第[一二三四五六七八九十百千零\d]+(部分|大题|节)|[一二三四五六七八九十]{1,3}、|(Part|Section)\s+[A-Z0-9IVX]+\b)/i.test(name)) {
        return name;
    }
    return `第${toChineseNumber(index + 1)}大题 ${name}`;
}

/** 题型显示名（中文，无法识别时原样保留） */
function typeDisplayName(questionType: string): string {
    const normalized = normalizeQuestionType(questionType);
    return normalized ? QUESTION_TYPE_NAMES_ZH[normalized] : questionType;
}

/**
 * 计算分组：section 优先，其次题型显示名，再无则全部归入 null（不分组）。
 * 返回有序的分组列表，保留题目原顺序（稳定分组：相邻同组归并，不相邻则拆成多个组）。
 */
export interface QuestionGroup {
    heading: string | null;
    /** 组内题目（带全局连续题号） */
    items: Array<{ question: StructuredQuestion; number: number }>;
}

export function groupQuestions(questions: StructuredQuestion[]): QuestionGroup[] {
    const groups: QuestionGroup[] = [];
    let currentHeading: string | null | undefined;
    let current: QuestionGroup | null = null;
    questions.forEach((question, index) => {
        const number = index + 1;
        let heading: string | null = null;
        if (question.section?.trim()) {
            heading = question.section.trim();
        } else if (question.questionType?.trim()) {
            heading = typeDisplayName(question.questionType.trim());
        }
        if (!current || currentHeading !== heading) {
            current = { heading, items: [] };
            groups.push(current);
            currentHeading = heading;
        }
        current.items.push({ question, number });
    });
    return groups;
}

/**
 * 生成 docx 段落结构（标题、分组大题标题、题目、文末参考答案）。
 * 抽出为纯函数便于单测直接断言段落文本。
 */
export function buildDocxParagraphs(questions: StructuredQuestion[], options: DocxExportOptions): Paragraph[] {
    const includeAnswers = options.includeAnswers ?? true;
    const includeImages = options.includeImages ?? false;
    const maxImageWidth = options.maxImageWidthPx ?? DEFAULT_MAX_IMAGE_WIDTH_PX;

    const paragraphs: Paragraph[] = [];
    if (options.title) {
        paragraphs.push(new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: [new TextRun(options.title)],
        }));
    }

    const groups = groupQuestions(questions);
    // 只有真正分组（标题非 null）时才输出大题标题
    const hasRealHeadings = groups.some((g) => g.heading !== null);
    let headingIndex = 0;
    for (const group of groups) {
        if (hasRealHeadings && group.heading !== null) {
            paragraphs.push(new Paragraph({
                heading: HeadingLevel.HEADING_2,
                children: [new TextRun(groupHeading(headingIndex, group.heading))],
            }));
            headingIndex += 1;
        }

        for (const { question, number } of group.items) {
            const stemLines = (question.text ?? "").replace(/\r\n?/g, "\n").split("\n");
            stemLines.forEach((line, lineIndex) => {
                paragraphs.push(new Paragraph({
                    children: [new TextRun(lineIndex === 0 ? `${number}. ${line}` : line)],
                }));
            });

            if (includeImages && question.images?.length) {
                for (const image of question.images) {
                    const decoded = dataUrlToImageBytes(image.dataUrl);
                    if (!decoded) continue;
                    const scaled = scaleToMaxWidth(decoded.widthPx, decoded.heightPx, maxImageWidth);
                    paragraphs.push(new Paragraph({
                        children: [new ImageRun({
                            type: decoded.type,
                            data: decoded.bytes,
                            transformation: { width: scaled.width, height: scaled.height },
                        })],
                    }));
                }
            }
        }
    }

    if (includeAnswers) {
        const answered = questions
            .map((question, index) => ({ question, number: index + 1 }))
            .filter(({ question }) => question.answer?.trim() || question.analysis?.trim());
        if (answered.length > 0) {
            paragraphs.push(new Paragraph({
                heading: HeadingLevel.HEADING_2,
                children: [new TextRun("参考答案")],
            }));
            for (const { question, number } of answered) {
                const answer = question.answer?.trim() ?? "";
                const analysis = question.analysis?.trim() ?? "";
                // 「N. 答案：… 解析：…」：parseAnswerEntryContent 能识别「解析：」前缀并回填
                const text = analysis ? `答案：${answer} 解析：${analysis}` : `答案：${answer}`;
                paragraphs.push(new Paragraph({
                    children: [new TextRun(`${number}. ${text}`)],
                }));
            }
        }
    }

    return paragraphs;
}

/**
 * 生成 .docx Blob（浏览器环境）。
 */
export async function buildQuestionsDocx(questions: StructuredQuestion[], options: DocxExportOptions): Promise<Blob> {
    const { Document, Packer } = await import("docx");
    const paragraphs = buildDocxParagraphs(questions, options);
    const doc = new Document({ sections: [{ children: paragraphs }] });
    return Packer.toBlob(doc);
}
