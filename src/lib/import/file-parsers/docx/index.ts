/**
 * docx 题库文件解析器：对外导出 parseDocx 与占位处理类型。
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
export { parseDocx, WARNING_SINGLE_QUESTION } from "@/lib/import/file-parsers/docx/parse";
export type { DocxInlineHandlers, DocxContext, DocxMathCollector } from "@/lib/import/file-parsers/docx/text";
export { DEFAULT_IMAGE_PLACEHOLDER, DEFAULT_MATH_PLACEHOLDER } from "@/lib/import/file-parsers/docx/text";
export { ommlToLatex } from "@/lib/import/file-parsers/docx/omml";
export type { OmmlResult } from "@/lib/import/file-parsers/docx/omml";
