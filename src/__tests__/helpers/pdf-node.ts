/**
 * 测试用：在 Node（vitest）中加载 pdfjs-dist 的 legacy 构建（主线程解析、无 worker），
 * 并给出标准字体目录，作为 parsePdf 的选项注入。应用代码只在浏览器中加载 pdfjs。
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { ParsePdfOptions } from "@/lib/import/file-parsers/pdf/parse";
import type { PdfjsModule } from "@/lib/import/file-parsers/pdf/load-pdfjs";

let cached: Promise<Required<Pick<ParsePdfOptions, "pdfjs" | "standardFontDataUrl">>> | null = null;

export function nodePdfOptions(): Promise<Required<Pick<ParsePdfOptions, "pdfjs" | "standardFontDataUrl">>> {
    if (!cached) {
        cached = (async () => {
            const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
            const req = createRequire(import.meta.url);
            const standardFontDataUrl = pathToFileURL(req.resolve("pdfjs-dist/package.json")).href.replace(/package\.json$/, "standard_fonts/");
            return { pdfjs, standardFontDataUrl };
        })();
    }
    return cached;
}
