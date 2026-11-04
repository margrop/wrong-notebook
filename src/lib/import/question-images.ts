/**
 * 题库文件导入的图片合成与压缩（浏览器端）。
 *
 * - 一题多张图时按顺序纵向拼成一张：等宽缩放、白底、间距固定。
 * - 输出统一压缩为 JPEG：长边 ≤ 1600、体积约 ≤ 1MB（质量 0.85，超限时逐步降质再缩小）。
 * - 透明 PNG 先铺白底再绘制，避免合成后发黑。
 *
 * 纯计算（尺寸、布局）与 canvas 绘制分离：纯函数可单测；
 * canvas 绘制通过可注入的 renderer 接口实现，测试中可用假实现替换。
 */

/** 合成后图片的最长边（像素） */
export const QUESTION_IMAGE_MAX_LONG_EDGE = 1600;
/** 合成后图片的目标体积上限（字节） */
export const QUESTION_IMAGE_MAX_BYTES = 1024 * 1024;
/** 合成 JPEG 初始质量 */
export const QUESTION_IMAGE_QUALITY = 0.85;
/** 多图拼接时的间距（像素，在目标宽度坐标系下） */
export const IMAGE_GAP = 16;
/** 每次缩小的比例（体积仍超限时） */
const SHRINK_STEP = 0.85;

export interface ImageDimensions {
    width: number;
    height: number;
}

/** 一张待合成的源图 */
export interface SourceImage {
    /** 解码后的绘制源（ImageBitmap / HTMLImageElement） */
    source: CanvasImageSource;
    /** 原始像素尺寸 */
    width: number;
    height: number;
}

/** 计算单张图在目标宽度下的等比缩放尺寸 */
export function scaleToWidth(width: number, height: number, targetWidth: number): ImageDimensions {
    if (width <= 0) return { width: targetWidth, height: 0 };
    const scale = targetWidth / width;
    return {
        width: targetWidth,
        height: Math.max(1, Math.round(height * scale)),
    };
}

/** 计算合成画布的总体尺寸（等宽缩放 + 间距） */
export function computeCompositeSize(
    images: ImageDimensions[],
    gap: number = IMAGE_GAP,
): ImageDimensions {
    if (images.length === 0) return { width: 0, height: 0 };
    const width = Math.max(...images.map((img) => img.width));
    const totalHeight = images.reduce((sum, img) => sum + img.height, 0) + gap * (images.length - 1);
    return { width, height: totalHeight };
}

/** 计算每张图在合成画布中的纵向偏移（按顺序从上到下） */
export function computeImageOffsets(images: ImageDimensions[], gap: number = IMAGE_GAP): number[] {
    const offsets: number[] = [];
    let current = 0;
    for (const img of images) {
        offsets.push(current);
        current += img.height + gap;
    }
    return offsets;
}

/** 按最长边限制计算输出尺寸（只缩小不放大） */
export function computeOutputSize(width: number, height: number, maxLongEdge: number = QUESTION_IMAGE_MAX_LONG_EDGE): ImageDimensions {
    const longEdge = Math.max(width, height);
    if (longEdge <= maxLongEdge) return { width, height };
    const scale = maxLongEdge / longEdge;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

/** canvas 绘制接口：注入以便测试中替换 */
export interface ImageRenderer {
    /**
     * 把多张图按布局纵向拼成一张白底 JPEG data URL。
     * images 中的 source 均为已解码的绘制源，scaled 为等宽缩放后的尺寸。
     */
    renderComposite(images: SourceImage[], layout: CompositeLayout): Promise<string>;
    /** 单张图压缩为 JPEG data URL（长边 ≤ maxLongEdge，体积 ≤ maxBytes） */
    renderSingle(image: SourceImage, maxLongEdge: number, maxBytes: number): Promise<string>;
}

/** 合成布局（computeCompositeSize + computeImageOffsets 的结果） */
export interface CompositeLayout {
    canvasWidth: number;
    canvasHeight: number;
    /** 每张图缩放后的尺寸与纵向偏移 */
    placements: Array<ImageDimensions & { y: number }>;
}

/** 计算完整合成布局（纯函数） */
export function computeCompositeLayout(images: ImageDimensions[], gap: number = IMAGE_GAP): CompositeLayout {
    const scaled = images.map((img) => scaleToWidth(img.width, img.height, Math.max(...images.map((i) => i.width))));
    const { width, height } = computeCompositeSize(scaled, gap);
    const offsets = computeImageOffsets(scaled, gap);
    return {
        canvasWidth: width,
        canvasHeight: height,
        placements: scaled.map((dims, i) => ({ ...dims, y: offsets[i] })),
    };
}

/** 默认的浏览器 canvas renderer */
export function createCanvasRenderer(): ImageRenderer {
    const createCanvas = (width: number, height: number): HTMLCanvasElement => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
    };

    const drawWhiteBackground = (ctx: CanvasRenderingContext2D, width: number, height: number): void => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
    };

    const toDataUrl = (canvas: HTMLCanvasElement, quality: number): string => {
        return canvas.toDataURL("image/jpeg", quality);
    };

    const estimateBytes = (dataUrl: string): number => {
        // base64 长度 × 3/4 约为字节数
        const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        return Math.floor(base64.length * 3 / 4);
    };

    return {
        async renderComposite(images: SourceImage[], layout: CompositeLayout): Promise<string> {
            const canvas = createCanvas(layout.canvasWidth, layout.canvasHeight);
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("CANVAS_UNSUPPORTED");
            drawWhiteBackground(ctx, layout.canvasWidth, layout.canvasHeight);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            for (let i = 0; i < images.length; i++) {
                const placement = layout.placements[i];
                ctx.drawImage(images[i].source, 0, 0, images[i].width, images[i].height, 0, placement.y, placement.width, placement.height);
            }
            let dataUrl = toDataUrl(canvas, QUESTION_IMAGE_QUALITY);
            // 体积超限时逐步缩小
            let scale = 1;
            while (estimateBytes(dataUrl) > QUESTION_IMAGE_MAX_BYTES && scale > 0.1) {
                scale *= SHRINK_STEP;
                const w = Math.max(1, Math.round(layout.canvasWidth * scale));
                const h = Math.max(1, Math.round(layout.canvasHeight * scale));
                const small = createCanvas(w, h);
                const smallCtx = small.getContext("2d");
                if (!smallCtx) throw new Error("CANVAS_UNSUPPORTED");
                drawWhiteBackground(smallCtx, w, h);
                smallCtx.imageSmoothingEnabled = true;
                smallCtx.imageSmoothingQuality = "high";
                for (let i = 0; i < images.length; i++) {
                    const placement = layout.placements[i];
                    smallCtx.drawImage(images[i].source, 0, 0, images[i].width, images[i].height, 0, Math.round(placement.y * scale), Math.round(placement.width * scale), Math.round(placement.height * scale));
                }
                dataUrl = toDataUrl(small, QUESTION_IMAGE_QUALITY);
            }
            return dataUrl;
        },

        async renderSingle(image: SourceImage, maxLongEdge: number, maxBytes: number): Promise<string> {
            const output = computeOutputSize(image.width, image.height, maxLongEdge);
            const canvas = createCanvas(output.width, output.height);
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("CANVAS_UNSUPPORTED");
            drawWhiteBackground(ctx, output.width, output.height);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(image.source, 0, 0, image.width, image.height, 0, 0, output.width, output.height);
            let dataUrl = toDataUrl(canvas, QUESTION_IMAGE_QUALITY);
            let scale = 1;
            while (estimateBytes(dataUrl) > maxBytes && scale > 0.1) {
                scale *= SHRINK_STEP;
                const w = Math.max(1, Math.round(output.width * scale));
                const h = Math.max(1, Math.round(output.height * scale));
                const small = createCanvas(w, h);
                const smallCtx = small.getContext("2d");
                if (!smallCtx) throw new Error("CANVAS_UNSUPPORTED");
                drawWhiteBackground(smallCtx, w, h);
                smallCtx.imageSmoothingEnabled = true;
                smallCtx.imageSmoothingQuality = "high";
                smallCtx.drawImage(image.source, 0, 0, image.width, image.height, 0, 0, w, h);
                dataUrl = toDataUrl(small, QUESTION_IMAGE_QUALITY);
            }
            return dataUrl;
        },
    };
}

/**
 * 把一题的多张图片合成并压缩为一张 JPEG data URL。
 * 单张也走压缩流程。renderer 可注入以便测试。
 */
export async function composeQuestionImage(
    images: SourceImage[],
    renderer: ImageRenderer = createCanvasRenderer(),
): Promise<string> {
    if (images.length === 0) throw new Error("NO_IMAGES");
    if (images.length === 1) {
        return renderer.renderSingle(images[0], QUESTION_IMAGE_MAX_LONG_EDGE, QUESTION_IMAGE_MAX_BYTES);
    }
    const dims = images.map((img) => ({ width: img.width, height: img.height }));
    const layout = computeCompositeLayout(dims);
    return renderer.renderComposite(images, layout);
}

/** 把 data URL 转为可绘制的 ImageBitmap（浏览器端解码） */
export async function decodeDataUrl(dataUrl: string): Promise<ImageBitmap> {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
    const blob = new Blob([bytes], { type: mime });
    return createImageBitmap(blob);
}

/** 从 data URL 构造 SourceImage（解码 + 尺寸） */
export async function sourceImageFromDataUrl(dataUrl: string): Promise<SourceImage> {
    const bitmap = await decodeDataUrl(dataUrl);
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
}
