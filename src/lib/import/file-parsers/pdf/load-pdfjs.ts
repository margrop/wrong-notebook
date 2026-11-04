/**
 * 加载 pdfjs-dist 的封装，与解析逻辑解耦，便于测试注入与环境适配。
 *
 * 应用内只在浏览器（客户端组件动态 import）中解析 PDF：使用 'pdfjs-dist'，设置 GlobalWorkerOptions.workerSrc
 * 指向 pdf.worker.min.mjs，解析在 worker 线程进行。
 * 本模块不得引用 Node 内置模块，否则客户端打包失败；测试用的 Node legacy 构建由
 * src/__tests__/helpers/pdf-node.ts 通过 parsePdf 的 pdfjs 选项注入。
 */
import type { getDocument, PDFDocumentProxy, PDFWorker } from "pdfjs-dist";

/** pdfjs 模块的最小类型（只用到的部分），避免直接依赖具体版本的导出形状 */
export interface PdfjsModule {
    getDocument: typeof getDocument;
    GlobalWorkerOptions: { workerSrc: string };
    PDFWorker: typeof PDFWorker;
}

/** getDocument 参数：pdfjs 官方 DocumentParameters 只用到这两个外加 standardFontDataUrl/verbosity */
export interface PdfGetDocumentParams {
    data: Uint8Array;
    standardFontDataUrl?: string;
    verbosity?: number;
}

/** 惰性创建浏览器端缓存，避免模块顶层副作用（如被服务端组件误引） */
let browserCache: Promise<PdfjsModule> | null = null;

/** 浏览器端加载 pdfjs：动态 import 并设置 workerSrc（new URL 让打包器生成 chunk 引用） */
export function loadPdfjsBrowser(): Promise<PdfjsModule> {
    if (!browserCache) {
        browserCache = (async () => {
            const pdfjs = (await import("pdfjs-dist")) as unknown as PdfjsModule;
            pdfjs.GlobalWorkerOptions.workerSrc = new URL(
                "pdfjs-dist/build/pdf.worker.min.mjs",
                import.meta.url,
            ).toString();
            return pdfjs;
        })();
    }
    return browserCache;
}

export type { PDFDocumentProxy };
