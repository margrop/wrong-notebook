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
 * 图片与公式输出占位符 [图片]/[公式]（可通过 handlers 扩展）。
 * 删除线、隐藏文字跳过；修订保留插入、跳过删除。
 * 页眉页脚、批注、脚注不处理。
 * 旧版 .doc 二进制返回 LEGACY_DOC_NOT_SUPPORTED；损坏的 zip 或非 docx 返回 INVALID_DOCX。
 *
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
import type { QuestionParseResult } from "@/lib/question-format/types";
import { parseQuestionFile } from "@/lib/question-format/parse";
import type { SplitTextQuestion } from "@/lib/question-split/text";
import { splitQuestionText } from "@/lib/question-split/text";
import type { TextSplitOptions } from "@/lib/question-split/text";
import { isLegacyDocFile, loadDocxParts } from "@/lib/import/file-parsers/docx/docx-xml";
import { NumberingResolver } from "@/lib/import/file-parsers/docx/numbering";
import type { DocxInlineHandlers, DocxContext } from "@/lib/import/file-parsers/docx/text";
import { paragraphText, tableRowText } from "@/lib/import/file-parsers/docx/text";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export const WARNING_SINGLE_QUESTION = "SINGLE_QUESTION";

/** 把 ignored 内容数量放入 warnings：IGNORED_PARAGRAPHS:N */
function ignoredWarning(count: number): string {
    return `IGNORED_PARAGRAPHS:${count}`;
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
 * 解析 docx 题库文件。
 * 旧版 .doc（文件头 D0 CF 11 E0）返回 LEGACY_DOC_NOT_SUPPORTED；
 * 损坏的 zip 或非 docx 返回 INVALID_DOCX（index 均为 -1）。
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

    const docxContext: DocxContext = { relationships: parts.relationships, files: parts.files };
    const resolver = new NumberingResolver(parts.numbering, parts.styles);
    const lines = extractLines(parts.document, resolver, handlers, docxContext);
    // 用空行连接段落，还原段落感；splitQuestionText 会再归一化
    const fullText = lines.join("\n");

    const split = splitQuestionText(fullText, splitOptions);
    const warnings: string[] = [];
    if (split.ignored.length > 0) warnings.push(ignoredWarning(split.ignored.length));
    if (!split.detected && split.questions.length === 1) warnings.push(WARNING_SINGLE_QUESTION);

    const result = parseQuestionFile(split.questions.map(toStructuredInput));
    return {
        questions: result.questions,
        errors: result.errors,
        warnings: [...warnings, ...result.warnings],
    };
}
