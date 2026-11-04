/**
 * PDF 题库文件解析入口。
 *
 * 流程：
 * 1. 通过 load-pdfjs 拿到 pdfjs 实例（浏览器启用 worker，Node/测试用 legacy 构建）
 * 2. 逐页 getTextContent，按坐标还原行（layout.ts）
 * 3. 全文送 splitQuestionText 分题；几乎没有文字层时返回 PDF_NO_TEXT_LAYER
 * 4. 把 SplitTextQuestion 转为 StructuredQuestion 后调用 parseQuestionFile 规范化
 * 5. 逐页 getOperatorList 检测图形元素（图片绘制 + 矢量路径），按分题行范围
 *    计算每题版面区域（regions.ts），作为 pdfRegions / pdfHasGraphics 附加返回
 *
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 * 连字/全角空格已归一；保留上下标的原始字符（不做公式识别）。
 */
import type { QuestionParseResult } from "@/lib/question-format/types";
import { parseQuestionFile, withoutExchangeFormatWarnings } from "@/lib/question-format/parse";
import type { SplitTextQuestion } from "@/lib/question-split/text";
import type { TextSplitOptions } from "@/lib/question-split/text";
import { splitQuestionText } from "@/lib/question-split/text";
import { linesToText, normalizePdfText, reconstructLines } from "@/lib/import/file-parsers/pdf/layout";
import type { PdfLine, PdfTextItem } from "@/lib/import/file-parsers/pdf/layout";
import { loadPdfjsBrowser } from "@/lib/import/file-parsers/pdf/load-pdfjs";
import type { PdfjsModule, PdfGetDocumentParams } from "@/lib/import/file-parsers/pdf/load-pdfjs";
import { getPdfjsDefaultParams } from "@/lib/import/file-parsers/pdf/load-pdfjs";
import { computeAllQuestionRegions } from "@/lib/import/file-parsers/pdf/regions";
import type { PdfQuestionRegions } from "@/lib/import/file-parsers/pdf/regions";
import { extractGraphicsFromOperatorList } from "@/lib/import/file-parsers/pdf/graphics";
import type { GraphicsOpsCodes, OperatorListLike, PdfGraphicElement } from "@/lib/import/file-parsers/pdf/graphics";

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
    /** 跳过 getOperatorList 图形检测（测试或不需要截图时减少开销） */
    skipGraphicsDetection?: boolean;
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

/** pdfjs OPS 编号：与加载的 pdfjs 版本动态对齐（6.x 为数字枚举） */
function resolveOpsCodes(pdfjs: PdfjsModule): GraphicsOpsCodes | null {
    const ops = (pdfjs as unknown as { OPS?: Record<string, number> }).OPS;
    if (!ops) return null;
    const keys: Array<keyof GraphicsOpsCodes> = [
        "save", "restore", "transform",
        "paintImageMaskXObject", "paintImageMaskXObjectGroup",
        "paintImageXObject", "paintInlineImageXObject", "paintInlineImageXObjectGroup",
        "paintImageXObjectRepeat", "paintImageMaskXObjectRepeat", "paintSolidColorImageMask",
        "constructPath",
    ];
    const codes = {} as GraphicsOpsCodes;
    for (const key of keys) {
        const value = ops[key];
        if (typeof value !== "number") return null;
        codes[key] = value;
    }
    return codes;
}

/**
 * 解析 PDF 题库文件（仅支持带文字层的 PDF；扫描版请用拍照/图片识别）。
 * 加密 PDF 返回 PDF_ENCRYPTED；损坏或不是 PDF 返回 INVALID_PDF（index 均为 -1）。
 * 几乎没有文字层（每页平均少于 20 字符）时返回 PDF_NO_TEXT_LAYER。
 */
export async function parsePdf(buffer: ArrayBuffer, options: ParsePdfOptions = {}): Promise<QuestionParseResult> {
    const pdfjs = options.pdfjs ?? (await loadPdfjsBrowser());
    // 复制一份交给 pdfjs：worker 会转移数据所有权，调用方的 buffer 之后还要用于扫描版渲染
    const data = new Uint8Array(buffer.slice(0));
    let doc;
    try {
        // 浏览器端统一带上 CMap 与标准字体路径；测试/Node 环境由调用方通过 options 注入
        const docParams: PdfGetDocumentParams = options.pdfjs
            ? (options.standardFontDataUrl
                ? { data, standardFontDataUrl: options.standardFontDataUrl, verbosity: 0 }
                : { data, verbosity: 0 })
            : { data, ...getPdfjsDefaultParams(), verbosity: 0 };
        doc = await pdfjs.getDocument(docParams).promise;
    } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name === "PasswordException") {
            return { questions: [], errors: [{ index: -1, reason: "PDF_ENCRYPTED" }], warnings: [] };
        }
        return { questions: [], errors: [{ index: -1, reason: "INVALID_PDF" }], warnings: [] };
    }

    const items: PdfTextItem[] = [];
    const pages: Array<{ width: number; height: number }> = [];
    /** 每页图形元素（parse 内检测，供 pdfRegions / pdfHasGraphics 使用） */
    const pageGraphics = new Map<number, PdfGraphicElement[]>();
    const opsCodes = options.skipGraphicsDetection ? null : resolveOpsCodes(pdfjs);
    let pageCount = 0;
    let textCharCount = 0;
    /** 每页文字字符数，用于统计空白页（有文字层但个别页没有文字） */
    const perPageChars: number[] = [];
    try {
        pageCount = doc.numPages;
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
            const page = await doc.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            pages.push({ width: viewport.width, height: viewport.height });
            if (opsCodes) {
                const opList = (await page.getOperatorList()) as unknown as OperatorListLike;
                const graphics = extractGraphicsFromOperatorList(opList, viewport.width, viewport.height, opsCodes);
                if (graphics.length > 0) pageGraphics.set(pageNumber, graphics);
            }
            const content = await page.getTextContent();
            let pageChars = 0;
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
                const trimmed = text.trim().length;
                pageChars += trimmed;
                textCharCount += trimmed;
            }
            perPageChars.push(pageChars);
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

    const lines: PdfLine[] = reconstructLines(items, pages);
    const fullText = linesToText(lines);
    const split = splitQuestionText(fullText, options.splitOptions);
    const warnings: string[] = [`PAGES:${pageCount}`];
    // 带文字层但个别页没有任何文字：提示空白页数（不阻断导入）
    const emptyPages = perPageChars.filter((count) => count === 0).length;
    if (emptyPages > 0) warnings.push(`EMPTY_PAGES:${emptyPages}`);
    if (split.ignored.length > 0) warnings.push(ignoredWarning(split.ignored.length));
    if (!split.detected && split.questions.length === 1) warnings.push(WARNING_SINGLE_QUESTION);

    const result = parseQuestionFile(split.questions.map(toStructuredInput));

    // 按 parseQuestionFile 的过滤结果对齐区域：errors 中的 index 对应 split.questions 下标
    // 图形框转为自上而下坐标，供区域计算收紧段底
    const graphicsTopDown = new Map(Array.from(pageGraphics.entries()).map(([page, elements]) => {
        const pageHeight = pages[page - 1]?.height ?? 0;
        return [page, elements.map(({ rect }) => ({ x: rect.x, yTop: pageHeight - rect.y - rect.height, width: rect.width, height: rect.height }))];
    }));
    const regions: PdfQuestionRegions = computeAllQuestionRegions(
        split.questions.map((question) => question.lineRange),
        lines,
        pages,
        graphicsTopDown,
    );
    const errorIndexes = new Set(result.errors.filter((error) => error.index >= 0).map((error) => error.index));
    const alignedRegions: PdfQuestionRegions = [];
    for (let index = 0; index < split.questions.length && alignedRegions.length < result.questions.length; index++) {
        if (errorIndexes.has(index)) continue;
        alignedRegions.push(regions[index] ?? null);
    }

    const pdfHasGraphics = pageGraphics.size > 0;
    const pdfPageGraphics: QuestionParseResult["pdfPageGraphics"] = Array.from({ length: pageCount }, (_, index) => pageGraphics.get(index + 1) ?? []);
    const pdfPageHeights = pages.map((page) => page.height);
    return {
        questions: result.questions,
        errors: result.errors,
        warnings: [...warnings, ...withoutExchangeFormatWarnings(result.warnings)],
        pdfRegions: alignedRegions,
        pdfHasGraphics,
        pdfPageGraphics,
        pdfPageHeights,
    };
}
