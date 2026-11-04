/**
 * PDF 题库文件解析入口。
 *
 * 流程：
 * 1. 通过 load-pdfjs 拿到 pdfjs 实例（浏览器启用 worker，Node/测试用 legacy 构建）
 * 2. 逐页 getTextContent，按坐标还原行（layout.ts）
 * 3. 全文送 splitQuestionText 分题；几乎没有文字层时返回 PDF_NO_TEXT_LAYER
 * 4. 把 SplitTextQuestion 转为 StructuredQuestion 后调用 parseQuestionFile 规范化
 *
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 * 连字/全角空格已归一；保留上下标的原始字符（不做公式识别）。
 */
import type { QuestionParseResult } from "@/lib/question-format/types";
import { parseQuestionFile } from "@/lib/question-format/parse";
import type { SplitTextQuestion } from "@/lib/question-split/text";
import type { TextSplitOptions } from "@/lib/question-split/text";
import { splitQuestionText } from "@/lib/question-split/text";
import { linesToText, normalizePdfText, reconstructLines } from "@/lib/import/file-parsers/pdf/layout";
import type { PdfTextItem } from "@/lib/import/file-parsers/pdf/layout";
import { loadPdfjsBrowser } from "@/lib/import/file-parsers/pdf/load-pdfjs";
import type { PdfjsModule } from "@/lib/import/file-parsers/pdf/load-pdfjs";

export const WARNING_SINGLE_QUESTION = "SINGLE_QUESTION";
/** 每页文字量低于该值视为「几乎没有文字层」 */
const MIN_TEXT_CHARS_PER_PAGE = 20;

export interface ParsePdfOptions {
    /** 分题参数（上限等），透传给 splitQuestionText */
    splitOptions?: TextSplitOptions;
    /** 覆盖默认的 pdfjs 实例（测试注入 Node legacy 构建用） */
    pdfjs?: PdfjsModule;
    /** 标准字体数据目录（Node 环境解码 Type1 标准字体需要；浏览器无需传） */
    standardFontDataUrl?: string;
}

/** 把 ignored 内容数量放入 warnings：IGNORED_PARAGRAPHS:N */
function ignoredWarning(count: number): string {
    return `IGNORED_PARAGRAPHS:${count}`;
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
    return record;
}

/**
 * 解析 PDF 题库文件（仅支持带文字层的 PDF；扫描版请用拍照/图片识别）。
 * 加密 PDF 返回 PDF_ENCRYPTED；损坏或不是 PDF 返回 INVALID_PDF（index 均为 -1）。
 * 几乎没有文字层（每页平均少于 20 字符）时返回 PDF_NO_TEXT_LAYER。
 */
export async function parsePdf(buffer: ArrayBuffer, options: ParsePdfOptions = {}): Promise<QuestionParseResult> {
    const pdfjs = options.pdfjs ?? (await loadPdfjsBrowser());
    const data = new Uint8Array(buffer);
    let doc;
    try {
        doc = await pdfjs.getDocument(options.standardFontDataUrl ? { data, standardFontDataUrl: options.standardFontDataUrl, verbosity: 0 } : { data }).promise;
    } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name === "PasswordException") {
            return { questions: [], errors: [{ index: -1, reason: "PDF_ENCRYPTED" }], warnings: [] };
        }
        return { questions: [], errors: [{ index: -1, reason: "INVALID_PDF" }], warnings: [] };
    }

    const items: PdfTextItem[] = [];
    const pages: Array<{ width: number; height: number }> = [];
    let pageCount = 0;
    let textCharCount = 0;
    try {
        pageCount = doc.numPages;
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
            const page = await doc.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            pages.push({ width: viewport.width, height: viewport.height });
            const content = await page.getTextContent();
            for (const item of content.items) {
                if (!("str" in item)) continue;
                const text = normalizePdfText(item.str);
                if (!text.trim()) continue;
                const [a, , , , x, y] = item.transform as Array<number>;
                const scaleX = Math.abs(a) || 1;
                items.push({
                    str: text,
                    x,
                    y,
                    width: item.width * scaleX,
                    height: item.height,
                    page: pageNumber,
                });
                textCharCount += text.trim().length;
            }
        }
    } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name === "PasswordException") {
            return { questions: [], errors: [{ index: -1, reason: "PDF_ENCRYPTED" }], warnings: [] };
        }
        return { questions: [], errors: [{ index: -1, reason: "INVALID_PDF" }], warnings: [] };
    } finally {
        try {
            await doc.cleanup();
        } catch {
            // cleanup 失败不影响结果（如部分版本的实现差异）
        }
    }

    if (pageCount === 0 || textCharCount / Math.max(pageCount, 1) < MIN_TEXT_CHARS_PER_PAGE) {
        return { questions: [], errors: [{ index: -1, reason: "PDF_NO_TEXT_LAYER" }], warnings: [`PAGES:${pageCount}`] };
    }

    const lines = reconstructLines(items, pages);
    const fullText = linesToText(lines);
    const split = splitQuestionText(fullText, options.splitOptions);
    const warnings: string[] = [`PAGES:${pageCount}`];
    if (split.ignored.length > 0) warnings.push(ignoredWarning(split.ignored.length));
    if (!split.detected && split.questions.length === 1) warnings.push(WARNING_SINGLE_QUESTION);

    const result = parseQuestionFile(split.questions.map(toStructuredInput));
    return { questions: result.questions, errors: result.errors, warnings: [...warnings, ...result.warnings] };
}
