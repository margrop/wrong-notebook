/**
 * 照片自动分题开始解析时，在浏览器中按各题区域从整页图裁剪出题目图片（沿用 image-pipeline 的尺寸、体积与质量限制）。
 * 一题有多个区域（如跨栏的题干与配图）时按顺序纵向拼接为一张图；单题拍照时一道题分在几张纸上，也用同样的方式拼接。
 */
import { renderRegion } from "@/lib/image-pipeline";
import type { RenderedImage } from "@/lib/image-pipeline";
import type { DraftRegion } from "@/lib/question-split/draft";

/** 裁剪时四周额外保留的边距（相对整图），避免框得太紧切掉题号或配图边缘 */
export const REGION_PADDING = 0.008;
/** 拼接多个区域时的间隔（像素） */
const STACK_GAP = 16;

export function padRegion(region: DraftRegion, padding = REGION_PADDING): DraftRegion {
    const x = Math.max(0, region.x - padding);
    const y = Math.max(0, region.y - padding);
    const right = Math.min(1, region.x + region.width + padding);
    const bottom = Math.min(1, region.y + region.height + padding);
    return { x, y, width: right - x, height: bottom - y };
}

/** 把 data URL 解码为图片元素 */
export async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
    const image = new Image();
    image.decoding = "async";
    image.src = dataUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("IMAGE_EMPTY");
    return image;
}

/** 一张参与拼接的图片：源图与要取的矩形（像素） */
interface StackPiece {
    source: CanvasImageSource;
    sx: number;
    sy: number;
    sw: number;
    sh: number;
    /** 绘制时的缩放比例（默认 1；scaleToWidth 时忽略） */
    scale?: number;
}

/**
 * 纵向拼接的版面，各段左对齐：
 * - scaleToWidth 为 true 时各段缩放到同一宽度（不同照片拍摄距离不同，字号才一致）；
 * - 否则按各段的 scale（默认 1）缩放，同一张图上的多个区域保持原尺寸。
 * 返回画布尺寸与每段的目标位置。
 */
export function stackLayout(sizes: Array<{ width: number; height: number; scale?: number }>, gap = STACK_GAP, scaleToWidth = false) {
    const widest = Math.max(...sizes.map((size) => size.width));
    let top = 0;
    const rects = sizes.map((size) => {
        const scale = scaleToWidth ? widest / size.width : (size.scale ?? 1);
        const rect = { x: 0, y: top, width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
        top += rect.height + gap;
        return rect;
    });
    return { width: Math.max(...rects.map((rect) => rect.width)), height: top - gap, rects };
}

/** 把若干段纵向拼成一张白底图，再按统一的尺寸、体积与质量限制编码 */
async function renderStack(pieces: StackPiece[], scaleToWidth: boolean): Promise<RenderedImage> {
    const layout = stackLayout(pieces.map((piece) => ({ width: piece.sw, height: piece.sh, scale: piece.scale })), STACK_GAP, scaleToWidth);
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("CANVAS_UNSUPPORTED");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    pieces.forEach((piece, index) => {
        const rect = layout.rects[index];
        context.drawImage(piece.source, piece.sx, piece.sy, piece.sw, piece.sh, rect.x, rect.y, rect.width, rect.height);
    });
    const bitmap = await createImageBitmap(canvas);
    try {
        return await renderRegion({ source: bitmap, width: canvas.width, height: canvas.height });
    } finally {
        bitmap.close();
    }
}

/** 按区域裁剪一道题的图片 */
export async function renderQuestionImage(page: HTMLImageElement, regions: DraftRegion[]): Promise<RenderedImage> {
    const width = page.naturalWidth;
    const height = page.naturalHeight;
    const padded = regions.map((region) => padRegion(region));
    if (padded.length === 1) return renderRegion({ source: page, width, height }, padded[0]);
    return renderStack(padded.map((region) => ({
        source: page,
        sx: Math.round(region.x * width),
        sy: Math.round(region.y * height),
        sw: Math.max(1, Math.round(region.width * width)),
        sh: Math.max(1, Math.round(region.height * height)),
    })), false);
}

/** 一道题分在几张纸上：把各张已裁好的图（data URL）按顺序纵向拼成一张，各段缩放到同一宽度 */
export async function stackQuestionImages(dataUrls: string[]): Promise<RenderedImage> {
    const images = await Promise.all(dataUrls.map(loadImage));
    return renderStack(images.map((image) => ({ source: image, sx: 0, sy: 0, sw: image.naturalWidth, sh: image.naturalHeight })), true);
}

/**
 * 照片自动分题的续页：把上一页中这道题的区域（按两页宽度之比缩放，字号与下一页一致）放在下一页整页的上方，
 * 拼成一张图交给自动分题，题目的前后两段在图中连在一起
 */
export async function renderContinuationPage(previous: HTMLImageElement, regions: DraftRegion[], next: { source: CanvasImageSource; width: number; height: number }): Promise<RenderedImage> {
    const width = previous.naturalWidth;
    const height = previous.naturalHeight;
    const scale = next.width / width;
    const pieces: StackPiece[] = regions.map((region) => padRegion(region)).map((region) => ({
        source: previous,
        sx: Math.round(region.x * width),
        sy: Math.round(region.y * height),
        sw: Math.max(1, Math.round(region.width * width)),
        sh: Math.max(1, Math.round(region.height * height)),
        scale,
    }));
    pieces.push({ source: next.source, sx: 0, sy: 0, sw: next.width, sh: next.height });
    return renderStack(pieces, false);
}
