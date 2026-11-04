/**
 * PDF 题库文件解析器：对外导出 parsePdf 与纯函数布局算法（供测试与注册表使用）。
 * 纯函数库，不依赖 Node 专有模块与 Prisma，可在浏览器和服务端同时使用。
 */
export { parsePdf, WARNING_SINGLE_QUESTION } from "@/lib/import/file-parsers/pdf/parse";
export type { ParsePdfOptions } from "@/lib/import/file-parsers/pdf/parse";
export { normalizePdfText, reconstructLines, linesToText } from "@/lib/import/file-parsers/pdf/layout";
export type { PdfTextItem, PdfLine } from "@/lib/import/file-parsers/pdf/layout";
export { loadPdfjsBrowser } from "@/lib/import/file-parsers/pdf/load-pdfjs";
export type { PdfjsModule } from "@/lib/import/file-parsers/pdf/load-pdfjs";
