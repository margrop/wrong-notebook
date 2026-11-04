/**
 * 扫描版 PDF 转图片：页码范围解析（纯函数）与逐页渲染（浏览器端）。
 *
 * - parsePageRanges：把 "1-3,5" 这类文本解析为去重升序的页码数组（纯函数，供测试）。
 * - computePdfRenderScale / computePdfOutputSize：按 DEFAULT_IMAGE_LIMITS 计算缩放与输出尺寸（纯函数）。
 * - renderPdfPages：用 pdfjs 把每页绘制成 canvas 再转为 JPEG data URL；
 *   逐页渲染、渲染完一页即释放 canvas 内存（把 canvas 宽高清零触发 GC）。
 * 本模块的渲染部分只在浏览器执行；纯函数部分不依赖 DOM，可在 Node 测试中使用。
 */

import { DEFAULT_IMAGE_LIMITS } from "@/lib/image-pipeline";
import type { ImageOutputLimits } from "@/lib/image-pipeline";

/** 单次扫描版 PDF 最多转换的页数 */
export const MAX_SCAN_PAGES_PER_IMPORT = 20;

export interface PageRangeError {
    kind: "empty" | "invalid" | "out_of_range";
    message: string;
}

export type PageRangeResult =
    | { ok: true; pages: number[] }
    | { ok: false; error: PageRangeError };

/**
 * 解析页码范围文本（如 "1-3,5"、"2"、"1, 3-4"）为去重升序页码数组。
 * pageCount 为 PDF 总页数；页码必须在 1～pageCount 内；解析结果最多 MAX_SCAN_PAGES_PER_IMPORT 页。
 * 返回错误时带可读信息。
 */
export function parsePageRanges(input: string, pageCount: number): PageRangeResult {
    const trimmed = input.trim();
    if (!trimmed) {
        return { ok: false, error: { kind: "empty", message: "页码范围不能为空" } };
    }
    const pages = new Set<number>();
    const segments = trimmed.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) {
        return { ok: false, error: { kind: "empty", message: "页码范围不能为空" } };
    }
    for (const segment of segments) {
        const match = segment.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!match) {
            return { ok: false, error: { kind: "invalid", message: `无法识别的页码段「${segment}」，请使用如 1-3,5 的写法` } };
        }
        const start = Number.parseInt(match[1], 10);
        const end = match[2] !== undefined ? Number.parseInt(match[2], 10) : start;
        if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
            return { ok: false, error: { kind: "out_of_range", message: `页码超出范围（共 ${pageCount} 页）` } };
        }
        if (end < start) {
            return { ok: false, error: { kind: "invalid", message: `页码段「${segment}」起始页不能大于结束页` } };
        }
        for (let p = start; p <= end; p++) pages.add(p);
    }
    const sorted = Array.from(pages).sort((a, b) => a - b);
    if (sorted.length === 0) {
        return { ok: false, error: { kind: "empty", message: "页码范围不能为空" } };
    }
    if (sorted.length > MAX_SCAN_PAGES_PER_IMPORT) {
        return { ok: false, error: { kind: "invalid", message: `单次最多转换 ${MAX_SCAN_PAGES_PER_IMPORT} 页，当前选择了 ${sorted.length} 页，请缩小范围` } };
    }
    return { ok: true, pages: sorted };
}

/** 按输出限制计算渲染缩放比例（只缩小不放大，与 image-pipeline 逻辑一致） */
export function computePdfRenderScale(
    viewportWidth: number,
    viewportHeight: number,
    limits: Pick<ImageOutputLimits, "maxLongEdge" | "maxPixels"> = DEFAULT_IMAGE_LIMITS,
): number {
    return Math.min(
        1,
        limits.maxLongEdge / Math.max(viewportWidth, viewportHeight),
        Math.sqrt(limits.maxPixels / Math.max(1, viewportWidth * viewportHeight)),
    );
}

/** 计算 PDF 页面渲染后的输出尺寸（像素） */
export function computePdfOutputSize(
    viewportWidth: number,
    viewportHeight: number,
    limits: Pick<ImageOutputLimits, "maxLongEdge" | "maxPixels"> = DEFAULT_IMAGE_LIMITS,
): { width: number; height: number; scale: number } {
    const scale = computePdfRenderScale(viewportWidth, viewportHeight, limits);
    return {
        width: Math.max(1, Math.floor(viewportWidth * scale)),
        height: Math.max(1, Math.floor(viewportHeight * scale)),
        scale,
    };
}

/** 渲染单页结果：JPEG data URL 与尺寸 */
export interface RenderedPdfPage {
    pageNumber: number;
    dataUrl: string;
    width: number;
    height: number;
    bytes: number;
}

/** pdfjs 页面代理的最小类型（避免直接依赖具体版本） */
export interface PdfPageProxyLike {
    getViewport(params: { scale: number }): { width: number; height: number };
    render(params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<unknown> };
}

/** pdfjs 文档代理的最小类型 */
export interface PdfDocumentProxyLike {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfPageProxyLike>;
    cleanup?(): Promise<void> | void;
}

export interface RenderPdfPagesOptions {
    /** 要渲染的页码（1 起；调用方保证已按上限校验） */
    pages: number[];
    /** 输出限制（默认 DEFAULT_IMAGE_LIMITS） */
    limits?: ImageOutputLimits;
    /** 每渲染完一页的回调（用于进度显示） */
    onProgress?: (completed: number, total: number) => void;
}

/** 把 canvas 内容编码为 JPEG data URL 并估算字节数 */
async function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality: number): Promise<string> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (!blob) {
                    reject(new Error("CANVAS_EMPTY"));
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(reader.error ?? new Error("READ_FAILED"));
                reader.readAsDataURL(blob);
            },
            "image/jpeg",
            quality,
        );
    });
}

function dataUrlBytes(dataUrl: string): number {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return Math.floor((base64.length * 3) / 4);
}

/**
 * 用 pdfjs 把指定页渲染为 JPEG data URL（逐页渲染，渲染完一页即释放 canvas）。
 * 渲染部分只在浏览器执行（需要 DOM canvas）；测试请注入 fake renderer 或使用纯函数部分。
 */
export async function renderPdfPages(
    doc: PdfDocumentProxyLike,
    options: RenderPdfPagesOptions,
): Promise<RenderedPdfPage[]> {
    const limits = options.limits ?? DEFAULT_IMAGE_LIMITS;
    const results: RenderedPdfPage[] = [];
    const total = options.pages.length;
    let canvas: HTMLCanvasElement | null = null;
    let context: CanvasRenderingContext2D | null = null;

    try {
        for (let i = 0; i < total; i++) {
            const pageNumber = options.pages[i];
            const page = await doc.getPage(pageNumber);
            const baseViewport = page.getViewport({ scale: 1 });
            const output = computePdfOutputSize(baseViewport.width, baseViewport.height, limits);

            if (!canvas || !context) {
                canvas = document.createElement("canvas");
                const created = canvas.getContext("2d");
                if (!created) throw new Error("CANVAS_UNSUPPORTED");
                context = created;
            }
            canvas.width = output.width;
            canvas.height = output.height;
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, output.width, output.height);

            const renderViewport = page.getViewport({ scale: output.scale });
            await page.render({ canvasContext: context, viewport: renderViewport }).promise;

            const dataUrl = await canvasToJpegDataUrl(canvas, limits.startQuality);
            results.push({
                pageNumber,
                dataUrl,
                width: output.width,
                height: output.height,
                bytes: dataUrlBytes(dataUrl),
            });

            // 释放 canvas 内存：把尺寸清零（保留 canvas 复用，但释放像素缓冲）
            canvas.width = 0;
            canvas.height = 0;

            options.onProgress?.(i + 1, total);
        }
    } finally {
        // 显式释放：确保最后一个 canvas 也被释放
        if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
        }
        try {
            await doc.cleanup?.();
        } catch {
            // cleanup 失败不影响结果
        }
    }

    return results;
}
