/**
 * 题库文件解析器注册表：按 IMPORT_FILE_TYPES 的 key 注册。
 * 所有解析器输出统一的 QuestionParseResult，新增格式只需注册新解析器。
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
import type { ImportFileTypeKey } from "@/lib/import/file-read";
import { parseJsonQuestionFile } from "@/lib/import/file-parsers/json";
import { parseDocx } from "@/lib/import/file-parsers/docx";
import { parseXlsxFile } from "@/lib/import/file-parsers/xlsx";
import { parseCsvText } from "@/lib/import/file-parsers/csv";
import { parsePdf } from "@/lib/import/file-parsers/pdf";
import { decodeTextFile } from "@/lib/import/file-read";
import { MAX_CLIENT_SPLIT_QUESTIONS, MAX_CLIENT_SPLIT_TEXT_LENGTH } from "@/lib/question-split/text";
import { parseTableRows } from "@/lib/import/file-parsers/table";
import type { QuestionParseResult } from "@/lib/question-format/types";

/** 解析器输入：文件名与文件内容 */
export interface FileParserInput {
    name: string;
    buffer: ArrayBuffer;
}

export type FileParser = (file: FileParserInput) => Promise<QuestionParseResult>;

/** docx / pdf 解析器注入的客户端分题上限：长文档不被默认 60 题截断 */
const DOCX_SPLIT_OPTIONS = {
    maxLength: MAX_CLIENT_SPLIT_TEXT_LENGTH,
    maxQuestions: MAX_CLIENT_SPLIT_QUESTIONS,
};

const PDF_SPLIT_OPTIONS = {
    maxLength: MAX_CLIENT_SPLIT_TEXT_LENGTH,
    maxQuestions: MAX_CLIENT_SPLIT_QUESTIONS,
};

async function parseCsvFile(file: FileParserInput): Promise<QuestionParseResult> {
    const { text } = decodeTextFile(file.buffer);
    const { rows } = parseCsvText(text);
    return parseTableRows(rows);
}

/**
 * 解析器注册表。text（TXT / Markdown）不在此处：走文字录入框填入逻辑。
 * docx 同时负责识别旧版 .doc（由 parseDocx 返回 LEGACY_DOC_NOT_SUPPORTED）。
 */
export const FILE_PARSERS: Partial<Record<ImportFileTypeKey, FileParser>> = {
    json: (file) => parseJsonQuestionFile(file.buffer),
    docx: (file) => parseDocx(file.buffer, {}, DOCX_SPLIT_OPTIONS),
    xlsx: (file) => parseXlsxFile(file.buffer),
    csv: parseCsvFile,
    pdf: (file) => parsePdf(file.buffer, { splitOptions: PDF_SPLIT_OPTIONS }),
};

/** 按类型 key 取解析器；未注册（如 text）返回 null */
export function getFileParser(key: ImportFileTypeKey): FileParser | null {
    return FILE_PARSERS[key] ?? null;
}
