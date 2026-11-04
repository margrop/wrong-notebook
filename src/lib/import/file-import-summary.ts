/**
 * 题库文件解析结果摘要（纯函数）。
 * 把解析器返回的错误码/警告码映射为中英文可读提示（带参数的码解析参数），
 * 并汇总题数、错误数、警告数与未导入字段统计。
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
import type { QuestionParseError, QuestionParseResult } from "@/lib/question-format/types";
import { countIgnoredFields, IGNORED_FIELD_LABELS } from "@/lib/import/structured-to-items";
import type { IgnoredField } from "@/lib/import/structured-to-items";

export type ImportLanguage = "zh" | "en";

/** 参数化错误码前缀 → 提示模板（{p} 为参数） */
const PARAMETERIZED_CODES: Record<string, { zh: (p: string) => string; en: (p: string) => string }> = {
    UNKNOWN_COLUMN: {
        zh: (p) => `未识别的列「${p}」，该列内容已忽略`,
        en: (p) => `Unrecognized column "${p}"; its content was ignored`,
    },
    IGNORED_PARAGRAPHS: {
        zh: (p) => `${p} 个段落未计入题目（标题、说明等）`,
        en: (p) => `${p} paragraph(s) not counted as questions (titles, notes, etc.)`,
    },
    TEXT_REQUIRED: {
        zh: (p) => (p.startsWith("row=") ? `第 ${p.slice(4)} 行缺少题干` : "缺少题干"),
        en: (p) => (p.startsWith("row=") ? `Row ${p.slice(4)} is missing question text` : "Question text is required"),
    },
};

/** 整体错误码（index 为 -1）映射 */
const GLOBAL_ERROR_CODES: Record<string, { zh: string; en: string }> = {
    INVALID_JSON: {
        zh: "不是合法的 JSON 文件，请检查文件内容",
        en: "Not a valid JSON file; please check the file content",
    },
    INVALID_DOCX: {
        zh: "无法读取该 Word 文件，文件可能已损坏或不是 .docx 格式",
        en: "Cannot read this Word file; it may be corrupted or not a .docx file",
    },
    LEGACY_DOC_NOT_SUPPORTED: {
        zh: "旧版 .doc 格式暂不支持，请在 Word 中另存为 .docx 后再导入",
        en: "Legacy .doc is not supported; please save it as .docx in Word and import again",
    },
    TEXT_COLUMN_NOT_FOUND: {
        zh: "未找到「题干」列，请使用题库模板或检查表头",
        en: 'No "question text" column found; please use the question template or check the header row',
    },
    EMPTY_TABLE: {
        zh: "表格为空，没有可导入的题目",
        en: "The table is empty; there are no questions to import",
    },
    QUESTIONS_REQUIRED: {
        zh: "文件中没有题目（questions 为空）",
        en: "The file contains no questions (questions is empty)",
    },
    INVALID_QUESTION_SHAPE: {
        zh: "题目格式不正确（questions 应为题目数组）",
        en: 'Invalid question format ("questions" should be an array of questions)',
    },
    PDF_NO_TEXT_LAYER: {
        zh: "这是扫描版 PDF（没有文字层），可在下方选择页码范围转为图片，由 AI 识别分题导入",
        en: "This is a scanned PDF (no text layer). You can select a page range below to convert it to images and import with AI recognition.",
    },
    PDF_ENCRYPTED: {
        zh: "这是加密 PDF，暂不支持导入，请先去除密码后重试",
        en: "This PDF is password-protected and cannot be imported; please remove the password and try again",
    },
    INVALID_PDF: {
        zh: "无法读取该 PDF 文件，文件可能已损坏或不是有效的 PDF",
        en: "Cannot read this PDF file; it may be corrupted or not a valid PDF",
    },
};

/** 逐题错误码映射（index ≥ 0） */
const QUESTION_ERROR_CODES: Record<string, { zh: string; en: string }> = {
    TEXT_REQUIRED: {
        zh: "缺少题干，已跳过",
        en: "Missing question text; skipped",
    },
    TEXT_TOO_LONG: {
        zh: "题干过长，已跳过",
        en: "Question text is too long; skipped",
    },
    MATERIAL_TOO_LONG: {
        zh: "公共材料过长，该题已跳过",
        en: "Shared material is too long; question skipped",
    },
    SECTION_TOO_LONG: {
        zh: "大题标题过长，该题已跳过",
        en: "Section title is too long; question skipped",
    },
    LABEL_TOO_LONG: {
        zh: "题号过长，该题已跳过",
        en: "Label is too long; question skipped",
    },
    ANSWER_TOO_LONG: {
        zh: "答案过长，该题已跳过",
        en: "Answer is too long; question skipped",
    },
    ANALYSIS_TOO_LONG: {
        zh: "解析过长，该题已跳过",
        en: "Analysis is too long; question skipped",
    },
    INVALID_DIFFICULTY: {
        zh: "难度值无效（应为 1～5），该题已跳过",
        en: "Invalid difficulty (should be 1–5); question skipped",
    },
    WRONG_ANSWER_TOO_LONG: {
        zh: "错答内容过长，该题已跳过",
        en: "Wrong answer is too long; question skipped",
    },
    SUBJECT_TOO_LONG: {
        zh: "学科字段过长，该题已跳过",
        en: "Subject is too long; question skipped",
    },
    GRADE_SEMESTER_TOO_LONG: {
        zh: "年级学期字段过长，该题已跳过",
        en: "Grade/semester is too long; question skipped",
    },
    SOURCE_TOO_LONG: {
        zh: "来源字段过长，该题已跳过",
        en: "Source is too long; question skipped",
    },
    QUESTION_TYPE_TOO_LONG: {
        zh: "题型字段过长，该题已跳过",
        en: "Question type is too long; question skipped",
    },
    KNOWLEDGE_POINT_TOO_LONG: {
        zh: "知识点过长，该题已跳过",
        en: "Knowledge point is too long; question skipped",
    },
    TOO_MANY_KNOWLEDGE_POINTS: {
        zh: "知识点数量超过上限，该题已跳过",
        en: "Too many knowledge points; question skipped",
    },
    INVALID_IMAGE_DATA_URL: {
        zh: "图片数据无效，该题已跳过",
        en: "Invalid image data; question skipped",
    },
    IMAGE_TOO_LARGE: {
        zh: "图片过大，该题已跳过",
        en: "Image is too large; question skipped",
    },
    TOO_MANY_IMAGES: {
        zh: "图片数量超过上限，该题已跳过",
        en: "Too many images; question skipped",
    },
    FIGURE_SVG_TOO_LONG: {
        zh: "配图 SVG 过长，该题已跳过",
        en: "Figure SVG is too long; question skipped",
    },
    INVALID_QUESTION_SHAPE: {
        zh: "题目格式不正确，该题已跳过",
        en: "Invalid question shape; skipped",
    },
};

/** 警告码映射（带参数的在 WARNING_PARAMETERIZED_CODES 中处理） */
const WARNING_CODES: Record<string, { zh: string; en: string }> = {
    MISSING_FORMAT: {
        zh: "文件缺少 format 字段，已按题目交换格式解析",
        en: 'The file is missing the "format" field; parsed as the question exchange format',
    },
    UNKNOWN_FORMAT: {
        zh: "format 字段不是已知的题目交换格式，已尝试按 v1 解析",
        en: 'The "format" field is not the known exchange format; tried parsing as v1',
    },
    MISSING_VERSION: {
        zh: "文件缺少 version 字段，已按 v1 解析",
        en: 'The file is missing the "version" field; parsed as v1',
    },
    UNSUPPORTED_VERSION: {
        zh: "文件版本高于当前支持的 v1，已按 v1 宽松规则解析",
        en: "The file version is newer than the supported v1; parsed with v1 tolerant rules",
    },
    TOO_MANY_QUESTIONS: {
        zh: "题目数量超过文件上限，超出部分已截断",
        en: "Question count exceeds the per-file limit; the rest was truncated",
    },
    SINGLE_QUESTION: {
        zh: "只识别出一道题；如果文件里有多道题，请检查题号格式",
        en: "Only one question was recognized; if the file has more, check the question numbering",
    },
};

/** 参数化警告码前缀 → 提示模板（{p} 为参数） */
const WARNING_PARAMETERIZED_CODES: Record<string, { zh: (p: string) => string; en: (p: string) => string }> = {
    UNKNOWN_COLUMN: {
        zh: (p) => `未识别的列「${p}」，该列内容已忽略`,
        en: (p) => `Unrecognized column "${p}"; its content was ignored`,
    },
    IGNORED_PARAGRAPHS: {
        zh: (p) => `${p} 个段落未计入题目（标题、说明等）`,
        en: (p) => `${p} paragraph(s) not counted as questions (titles, notes, etc.)`,
    },
    IMAGE_UNSUPPORTED: {
        zh: (p) => `以下格式的图片暂不支持导入，已跳过：${p}`,
        en: (p) => `Image format(s) not supported, skipped: ${p}`,
    },
    METAFILE_RENDERED: {
        zh: (p) => `${p} 个公式预览图（WMF/EMF）已渲染为图片`,
        en: (p) => `${p} equation preview image(s) (WMF/EMF) rendered`,
    },
    METAFILE_FAILED: {
        zh: (p) => `${p} 个公式预览图（WMF/EMF）渲染失败，未包含在题目原图中`,
        en: (p) => `${p} equation preview image(s) (WMF/EMF) failed to render and were left out`,
    },
    METAFILE_TRUNCATED: {
        zh: (p) => `${p} 个公式小图超出单题拼接上限，未包含在题目原图中`,
        en: (p) => `${p} small equation image(s) exceeded the per-question merge limit and were left out`,
    },
    OLE_EQUATION_LATEX: {
        zh: (p) => `${p} 个 MathType 公式对象已转为 LaTeX`,
        en: (p) => `${p} MathType equation object(s) converted to LaTeX`,
    },
    OLE_EQUATION_IMAGE: {
        zh: (p) => `${p} 个 MathType 公式对象按图片保留（复杂公式无法可靠还原）`,
        en: (p) => `${p} MathType equation object(s) kept as image(s) (complex formula could not be reliably converted)`,
    },
    MATH_UNSUPPORTED: {
        zh: (p) => `部分 OMML 结构未识别：${p}`,
        en: (p) => `Some OMML structures not recognized: ${p}`,
    },
    PAGES: {
        zh: (p) => `共 ${p} 页`,
        en: (p) => `${p} page${p === "1" ? "" : "s"} in total`,
    },
    EMPTY_PAGES: {
        zh: (p) => `其中 ${p} 页没有文字内容（空白页或纯图片页），未计入题目`,
        en: (p) => `${p} page${p === "1" ? " has" : "s have"} no text content (blank or image-only) and were not counted as questions`,
    },
};

/** 把错误码（可能带 :参数 后缀）映射为可读提示 */
export function describeQuestionError(reason: string, language: ImportLanguage): string {
    const sep = reason.indexOf(":");
    const code = sep === -1 ? reason : reason.slice(0, sep);
    const param = sep === -1 ? "" : reason.slice(sep + 1);

    if (param && PARAMETERIZED_CODES[code]) {
        return PARAMETERIZED_CODES[code][language](param);
    }
    const template = QUESTION_ERROR_CODES[code] ?? GLOBAL_ERROR_CODES[code];
    if (template) return template[language];
    return language === "zh" ? `未知错误（${reason}）` : `Unknown error (${reason})`;
}

/** 把警告码（可能带 :参数 后缀或 [工作表] 前缀）映射为可读提示 */
export function describeWarning(warning: string, language: ImportLanguage): string {
    // xlsx 多表时给警告加 `[工作表名] ` 前缀，原样保留前缀
    const sheetMatch = warning.match(/^(\[[^\]]*\])\s*(.*)$/);
    const prefix = sheetMatch ? sheetMatch[1] : "";
    const body = sheetMatch ? sheetMatch[2] : warning;

    const sep = body.indexOf(":");
    const code = sep === -1 ? body : body.slice(0, sep);
    const param = sep === -1 ? "" : body.slice(sep + 1);

    let text: string;
    if (param && WARNING_PARAMETERIZED_CODES[code]) {
        text = WARNING_PARAMETERIZED_CODES[code][language](param);
    } else {
        const template = WARNING_CODES[code];
        text = template ? template[language] : language === "zh" ? `未知警告（${body}）` : `Unknown warning (${body})`;
    }
    return prefix ? `${prefix} ${text}` : text;
}

/** 未导入字段的可读文案（字段名 + 出现次数） */
export function describeIgnoredFields(
    counts: Array<{ field: IgnoredField; count: number }>,
    language: ImportLanguage,
): string[] {
    return counts.map(({ field, count }) => {
        const label = IGNORED_FIELD_LABELS[field][language];
        return language === "zh" ? `${label}（${count} 题）` : `${label} (${count} question${count > 1 ? "s" : ""})`;
    });
}

/** 导入摘要：题数、错误、警告、未导入字段 */
export interface FileImportSummary {
    total: number;
    /** 可导入的题目数（= total） */
    importable: number;
    errorCount: number;
    warningCount: number;
    /** 错误明细（前若干条），含题号与可读提示 */
    errors: Array<{ index: number; message: string }>;
    warnings: string[];
    ignoredFields: Array<{ field: IgnoredField; count: number }>;
    ignoredFieldTexts: string[];
}

/** 最大展示的错误条数 */
export const MAX_SHOWN_ERRORS = 5;

/** 由解析结果构建导入摘要（错误按可读性排序，最多展示前 MAX_SHOWN_ERRORS 条） */
export function buildImportSummary(result: QuestionParseResult, language: ImportLanguage): FileImportSummary {
    const errors = result.errors
        .slice()
        .sort((a, b) => a.index - b.index)
        .slice(0, MAX_SHOWN_ERRORS)
        .map((error: QuestionParseError) => ({
            index: error.index,
            message: describeQuestionError(error.reason, language),
        }));
    const warnings = result.warnings.map((warning) => describeWarning(warning, language));
    const ignoredFields = countIgnoredFields(result.questions);
    return {
        total: result.questions.length,
        importable: result.questions.length,
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
        errors,
        warnings,
        ignoredFields,
        ignoredFieldTexts: describeIgnoredFields(ignoredFields, language),
    };
}
