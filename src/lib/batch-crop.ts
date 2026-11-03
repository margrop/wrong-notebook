/**
 * 照片自动分题开始解析时，在浏览器中按各题区域从整页图裁剪出题目图片（沿用 image-pipeline 的尺寸、体积与质量限制）。
 * 一题有多个区域（如跨栏的题干与配图）时按顺序纵向拼接为一张图。
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

/** 按区域裁剪一道题的图片 */
export async function renderQuestionImage(page: HTMLImageElement, regions: DraftRegion[]): Promise<RenderedImage> {
    const width = page.naturalWidth;
    const height = page.naturalHeight;
    const padded = regions.map((region) => padRegion(region));
    if (padded.length === 1) return renderRegion({ source: page, width, height }, padded[0]);

    const rects = padded.map((region) => ({
        sx: Math.round(region.x * width),
        sy: Math.round(region.y * height),
        sw: Math.max(1, Math.round(region.width * width)),
        sh: Math.max(1, Math.round(region.height * height)),
    }));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(...rects.map((rect) => rect.sw));
    canvas.height = rects.reduce((sum, rect) => sum + rect.sh, 0) + STACK_GAP * (rects.length - 1);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("CANVAS_UNSUPPORTED");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    let top = 0;
    for (const rect of rects) {
        context.drawImage(page, rect.sx, rect.sy, rect.sw, rect.sh, 0, top, rect.sw, rect.sh);
        top += rect.sh + STACK_GAP;
    }
    const bitmap = await createImageBitmap(canvas);
    try {
        return await renderRegion({ source: bitmap, width: canvas.width, height: canvas.height });
    } finally {
        bitmap.close();
    }
}
