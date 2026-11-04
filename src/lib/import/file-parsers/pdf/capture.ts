/**
 * 文字版 PDF 题目原图截图（浏览器端）：
 * 按题目版面区域（regions.ts 输出的 PdfPageRegion）渲染对应页面、裁剪并拼接为一张 JPEG。
 *
 * - 每页只渲染一次并复用：按目标「裁剪后长边约 1600px」反推渲染缩放；
 * - 裁剪在渲染 canvas 上直接 drawImage 到临时 canvas，再释放；
 * - 多段纵向拼接复用 question-images 的 computeCompositeLayout + ImageRenderer；
 * - 单题失败抛出异常，由调用方捕获并记录 warning，不影响其他题。
 *
 * 只在浏览器执行（需要 DOM canvas）；纯函数（computeCaptureScale）可单测。
 */

import type { ImageRenderer, SourceImage } from "@/lib/import/question-images";
import { composeQuestionImage } from "@/lib/import/question-images";
import type { PdfPageRegion } from "@/lib/import/file-parsers/pdf/regions";
import type { PdfDocumentProxyLike } from "@/lib/import/file-parsers/pdf/render-pages";

/** 裁剪后长边目标像素（与 QUESTION_IMAGE_MAX_LONG_EDGE 对齐） */
export const CAPTURE_TARGET_LONG_EDGE = 1600;

/**
 * 计算区域截图的渲染缩放：使「该区域在页面上渲染后的最长边」约等于 targetLongEdge。
 * 只放大不缩小（scale 上限 3，避免小区域渲染过大浪费内存）。
 */
export function computeCaptureScale(
    regionLongEdgePt: number,
    pageLongEdgePt: number,
    targetLongEdgePx: number = CAPTURE_TARGET_LONG_EDGE,
): number {
    if (regionLongEdgePt <= 0 || pageLongEdgePt <= 0) return 1;
    const scale = targetLongEdgePx / regionLongEdgePt;
    return Math.min(3, Math.max(1, scale));
}

/** 截图所需页面代理（与 render-pages.ts 一致的最小类型） */
interface PdfPageProxyCapture {
    getViewport(params: { scale: number }): { width: number; height: number };
    render(params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<unknown> };
}

/** 渲染一页到 canvas 并返回（调用方负责释放） */
async function renderPageToCanvas(
    page: PdfPageProxyCapture,
    scale: number,
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("CANVAS_UNSUPPORTED");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return { canvas, width: canvas.width, height: canvas.height };
}

/** 把渲染页按区域（PDF 坐标，yTop 自上而下）裁剪为 ImageBitmap */
async function cropRegion(
    source: HTMLCanvasElement,
    sourceScale: number,
    region: PdfPageRegion,
): Promise<ImageBitmap> {
    const sx = Math.max(0, Math.round(region.rect.x * sourceScale));
    const sy = Math.max(0, Math.round(region.rect.yTop * sourceScale));
    const sw = Math.max(1, Math.round(region.rect.width * sourceScale));
    const sh = Math.max(1, Math.round(region.rect.height * sourceScale));
    // 边界钳制：不超出源 canvas
    const maxW = source.width - sx;
    const maxH = source.height - sy;
    const w = Math.min(sw, maxW);
    const h = Math.min(sh, maxH);
    if (w < 1 || h < 1) throw new Error("CROP_OUT_OF_BOUNDS");
    return createImageBitmap(source, sx, sy, w, h);
}

/** 把 ImageBitmap 包成 SourceImage */
function toSourceImage(bitmap: ImageBitmap): SourceImage {
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
}

/**
 * 为一道题按区域段截图并合成单张 JPEG data URL。
 *
 * @param doc        pdfjs 文档代理（调用方负责 cleanup）
 * @param regions    该题的区域段（至少一段）
 * @param renderer   合成用 renderer（默认浏览器 canvas renderer）
 * @param targetLongEdgePx  裁剪后长边目标像素
 */
export async function captureQuestionImage(
    doc: PdfDocumentProxyLike,
    regions: PdfPageRegion[],
    renderer?: ImageRenderer,
    targetLongEdgePx: number = CAPTURE_TARGET_LONG_EDGE,
): Promise<string> {
    if (regions.length === 0) throw new Error("NO_REGIONS");

    // 按页分组，每页只渲染一次；不同页可用不同缩放（按该页区域长边计算）
    const byPage = new Map<number, PdfPageRegion[]>();
    for (const region of regions) {
        const list = byPage.get(region.page) ?? [];
        list.push(region);
        byPage.set(region.page, list);
    }

    const segments: SourceImage[] = [];
    try {
        for (const [pageNumber, pageRegions] of byPage) {
            const page = (await doc.getPage(pageNumber)) as unknown as PdfPageProxyCapture;
            const baseViewport = page.getViewport({ scale: 1 });
            // 该页区域的最大长边（pt）
            const pageLongEdgePt = Math.max(baseViewport.width, baseViewport.height);
            const regionLongEdgePt = Math.max(...pageRegions.map((region) => Math.max(region.rect.width, region.rect.height)));
            const captureScale = computeCaptureScale(regionLongEdgePt, pageLongEdgePt, targetLongEdgePx);
            const { canvas } = await renderPageToCanvas(page, captureScale);
            try {
                for (const region of pageRegions) {
                    const bitmap = await cropRegion(canvas, captureScale, region);
                    segments.push(toSourceImage(bitmap));
                }
            } finally {
                canvas.width = 0;
                canvas.height = 0;
            }
        }
        return await composeQuestionImage(segments, renderer);
    } finally {
        // 释放所有 ImageBitmap
        for (const segment of segments) {
            if (segment.source instanceof ImageBitmap) segment.source.close();
        }
    }
}
