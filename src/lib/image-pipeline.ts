/**
 * 题目图片处理流程（浏览器端）：读取 → 解码（含 HEIC/HEIF 转换与方向处理）→ 预览缩略图 → 按原图裁剪 → 限制尺寸与体积后编码为 JPEG。
 *
 * - 按文件头识别真实格式，不依赖文件扩展名或浏览器报告的 MIME。
 * - 优先使用系统解码（Safari 等可直接解码 HEIC）；系统无法解码的 HEIC/HEIF 才按需加载解码库（libheif，约 2MB），
 *   转为真正的 JPEG 后再解码，转换在进入裁剪预览之前完成。
 * - 方向：系统解码按 EXIF 方向（imageOrientation: from-image），HEIC 由解码库按容器中的旋转/镜像信息处理。
 * - 裁剪预览只用缩略图，裁剪坐标为相对坐标，最终从原图裁剪，一次缩放到输出尺寸，避免多次高分辨率转换。
 * - 输出同时按最长边、总像素和体积限制；质量不低于下限，体积仍超出时缩小尺寸而不是继续降低质量，保护小字与公式。
 * - 日志只记录格式、像素、体积和用时，不记录图片内容。
 */
import type { ImageRegion } from "@/lib/image-crop";
import type { ImportImageInfo } from "@/lib/import/import-task-types";

export interface ImageOutputLimits {
    /** 最长边（像素） */
    maxLongEdge: number;
    /** 总像素 */
    maxPixels: number;
    /** 编码后的最大字节数 */
    maxBytes: number;
    /** 初始 JPEG 质量 */
    startQuality: number;
    /** 最低 JPEG 质量；达到后仍超出体积时缩小尺寸 */
    minQuality: number;
}

/**
 * 默认输出限制：约 490 万像素（2560×1920）、最长边 4096、1.5MB、质量 0.9→0.8。
 * 整页手机照片竖拍（3024×4032）输出 1920×2560，与原先按 1920 宽缩放相同；横拍（4032×3024）输出 2560×1920，
 * 比原先的 1920×1440 多保留细节。题目裁剪区域通常在像素上限内，按原分辨率输出。
 * 原先小于 1MB 的图片不做任何缩放（如 800×8000 的长图原样上传），现在同样受像素与最长边限制。
 */
export const DEFAULT_IMAGE_LIMITS: ImageOutputLimits = {
    maxLongEdge: 4096,
    maxPixels: 2560 * 1920,
    maxBytes: 1.5 * 1024 * 1024,
    startQuality: 0.9,
    minQuality: 0.8,
};

/** 裁剪预览缩略图的最长边 */
export const PREVIEW_LONG_EDGE = 1600;
/** 体积超出时每次缩小的比例 */
const SHRINK_STEP = 0.85;
const QUALITY_STEP = 0.05;

export type ImageFormat = "jpeg" | "png" | "webp" | "gif" | "bmp" | "heic" | "avif" | "unknown";

/** 解码失败的原因：HEIC 解码库也无法解码、系统无法解码、或不是图片 */
export type ImageDecodeErrorCode = "HEIC_DECODE_FAILED" | "IMAGE_DECODE_FAILED" | "UNSUPPORTED_IMAGE";

export class ImageDecodeError extends Error {
    constructor(readonly code: ImageDecodeErrorCode, readonly format: ImageFormat, cause?: unknown) {
        super(code, cause === undefined ? undefined : { cause });
        this.name = "ImageDecodeError";
    }
}

/** HEVC 编码的 HEIF 品牌（iPhone 等手机照片） */
const HEVC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs"]);
/** 通用 HEIF 品牌，AVIF 文件也会带上 */
const GENERIC_HEIF_BRANDS = new Set(["mif1", "msf1", "mif2"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

/** 按文件头识别图片格式（ISO BMFF 的 ftyp 品牌区分 HEIC/HEIF 与 AVIF） */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat {
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
    if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
    if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
    if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "gif";
    if (bytes.length >= 2 && ascii(0, 2) === "BM") return "bmp";
    if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
        const size = Math.min(bytes.length, ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0 || bytes.length);
        const brands = [ascii(8, 12)];
        for (let offset = 16; offset + 4 <= size; offset += 4) brands.push(ascii(offset, offset + 4));
        if (brands.some((brand) => HEVC_BRANDS.has(brand))) return "heic";
        if (brands.some((brand) => AVIF_BRANDS.has(brand))) return "avif";
        if (brands.some((brand) => GENERIC_HEIF_BRANDS.has(brand))) return "heic";
    }
    return "unknown";
}

/** 按尺寸限制计算输出大小（只缩小不放大） */
export function computeOutputSize(width: number, height: number, limits: Pick<ImageOutputLimits, "maxLongEdge" | "maxPixels"> = DEFAULT_IMAGE_LIMITS) {
    const scale = Math.min(
        1,
        limits.maxLongEdge / Math.max(width, height),
        Math.sqrt(limits.maxPixels / Math.max(1, width * height)),
    );
    return {
        width: Math.max(1, Math.floor(width * scale)),
        height: Math.max(1, Math.floor(height * scale)),
        scale,
    };
}

type DecodedSource = ImageBitmap | HTMLImageElement;

export interface PreparedImage {
    /** 已按方向校正的原图 */
    source: DecodedSource;
    width: number;
    height: number;
    format: ImageFormat;
    decoder: "native" | "heic";
    /** 裁剪预览用的缩略图地址（blob:） */
    previewUrl: string;
    sourceType: string;
    sourceBytes: number;
    timings: { read: number; convert: number };
    dispose: () => void;
}

export interface RenderedImage {
    dataUrl: string;
    width: number;
    height: number;
    bytes: number;
    quality: number;
    timings: { crop: number; compress: number };
}

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "async";
    return new Promise<HTMLImageElement>((resolve, reject) => {
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("IMAGE_ELEMENT_DECODE_FAILED"));
        image.src = url;
    }).finally(() => URL.revokeObjectURL(url));
}

/** 系统解码：优先 createImageBitmap（按 EXIF 方向），不支持时退回 <img>（现代浏览器默认按 EXIF 方向绘制） */
async function decodeNative(blob: Blob): Promise<DecodedSource> {
    if (typeof createImageBitmap === "function") {
        try {
            return await createImageBitmap(blob, { imageOrientation: "from-image" });
        } catch {
            // 部分浏览器不支持选项参数或该格式，再用 <img> 尝试
        }
    }
    const image = await loadImageElement(blob);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("IMAGE_EMPTY");
    return image;
}

function sourceSize(source: DecodedSource): { width: number; height: number } {
    return source instanceof HTMLImageElement
        ? { width: source.naturalWidth, height: source.naturalHeight }
        : { width: source.width, height: source.height };
}

/** HEIC/HEIF 转为 JPEG：按需加载解码库，不进入首屏代码 */
async function convertHeic(blob: Blob): Promise<Blob> {
    const { heicTo } = await import("heic-to/csp");
    return heicTo({ blob, type: "image/jpeg", quality: 0.95 });
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("CANVAS_EMPTY"))), "image/jpeg", quality);
    });
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("READ_FAILED"));
        reader.readAsDataURL(blob);
    });
}

/** 把源图的一个区域绘制到指定大小的画布（白底，透明 PNG 转 JPEG 不变黑） */
function drawRegion(source: DecodedSource, sx: number, sy: number, sw: number, sh: number, width: number, height: number): HTMLCanvasElement {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("CANVAS_UNSUPPORTED");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
    return canvas;
}

/** 读取并解码图片文件，生成裁剪预览缩略图；需要转换 HEIC 时通过 onConverting 通知（用于显示阶段） */
export async function prepareImage(file: Blob, onConverting?: () => void): Promise<PreparedImage> {
    const readStarted = performance.now();
    const buffer = await file.arrayBuffer();
    const read = performance.now() - readStarted;
    const format = sniffImageFormat(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64)));
    const sourceType = file.type || "";

    const convertStarted = performance.now();
    let source: DecodedSource;
    let decoder: PreparedImage["decoder"] = "native";
    const blob = new Blob([buffer], { type: sourceType || "application/octet-stream" });
    try {
        source = await decodeNative(blob);
    } catch (nativeError) {
        if (format !== "heic") {
            throw new ImageDecodeError(format === "unknown" ? "UNSUPPORTED_IMAGE" : "IMAGE_DECODE_FAILED", format, nativeError);
        }
        onConverting?.();
        try {
            source = await decodeNative(await convertHeic(blob));
            decoder = "heic";
        } catch (heicError) {
            throw new ImageDecodeError("HEIC_DECODE_FAILED", format, heicError);
        }
    }
    const { width, height } = sourceSize(source);
    if (!width || !height) throw new ImageDecodeError("IMAGE_DECODE_FAILED", format);

    // 预览缩略图：只用于显示和框选，裁剪仍从原图进行
    const preview = computeOutputSize(width, height, { maxLongEdge: PREVIEW_LONG_EDGE, maxPixels: Number.POSITIVE_INFINITY });
    const previewBlob = await canvasToBlob(drawRegion(source, 0, 0, width, height, preview.width, preview.height), 0.85);
    const previewUrl = URL.createObjectURL(previewBlob);
    const convert = performance.now() - convertStarted;

    return {
        source,
        width,
        height,
        format,
        decoder,
        previewUrl,
        sourceType,
        sourceBytes: file.size,
        timings: { read: Math.round(read), convert: Math.round(convert) },
        dispose: () => {
            URL.revokeObjectURL(previewUrl);
            if (!(source instanceof HTMLImageElement)) source.close();
        },
    };
}

const FULL_IMAGE: ImageRegion = { x: 0, y: 0, width: 1, height: 1 };

/** 从原图裁剪区域并编码为 JPEG：先降质量到下限，仍超出体积时再缩小尺寸 */
export async function renderRegion(prepared: Pick<PreparedImage, "source" | "width" | "height">, region: ImageRegion = FULL_IMAGE, limits: ImageOutputLimits = DEFAULT_IMAGE_LIMITS): Promise<RenderedImage> {
    const cropStarted = performance.now();
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const sx = Math.round(clamp(region.x) * prepared.width);
    const sy = Math.round(clamp(region.y) * prepared.height);
    const sw = Math.max(1, Math.min(prepared.width - sx, Math.round(clamp(region.width) * prepared.width)));
    const sh = Math.max(1, Math.min(prepared.height - sy, Math.round(clamp(region.height) * prepared.height)));
    let size = computeOutputSize(sw, sh, limits);
    let canvas = drawRegion(prepared.source, sx, sy, sw, sh, size.width, size.height);
    const crop = performance.now() - cropStarted;

    const compressStarted = performance.now();
    let quality = limits.startQuality;
    let blob = await canvasToBlob(canvas, quality);
    for (let attempt = 0; blob.size > limits.maxBytes && attempt < 12; attempt++) {
        if (quality - QUALITY_STEP >= limits.minQuality - 1e-9) {
            quality = Math.round((quality - QUALITY_STEP) * 100) / 100;
        } else {
            size = { width: Math.max(1, Math.floor(size.width * SHRINK_STEP)), height: Math.max(1, Math.floor(size.height * SHRINK_STEP)), scale: size.scale * SHRINK_STEP };
            canvas = drawRegion(prepared.source, sx, sy, sw, sh, size.width, size.height);
        }
        blob = await canvasToBlob(canvas, quality);
    }
    const dataUrl = await blobToDataUrl(blob);
    return {
        dataUrl,
        width: size.width,
        height: size.height,
        bytes: blob.size,
        quality,
        timings: { crop: Math.round(crop), compress: Math.round(performance.now() - compressStarted) },
    };
}

/** 上传任务附带的图片信息（不含图片内容） */
export function describeImage(prepared: PreparedImage, rendered: RenderedImage): ImportImageInfo {
    return {
        sourceType: prepared.sourceType || prepared.format,
        sourceBytes: prepared.sourceBytes,
        sourceWidth: prepared.width,
        sourceHeight: prepared.height,
        outputWidth: rendered.width,
        outputHeight: rendered.height,
        outputBytes: rendered.bytes,
        decoder: prepared.decoder,
        quality: rendered.quality,
    };
}

/** 整张图片走一遍处理流程（不裁剪），返回 JPEG data URL */
export async function processImageBlob(file: Blob, limits: ImageOutputLimits = DEFAULT_IMAGE_LIMITS): Promise<{ prepared: PreparedImage; rendered: RenderedImage }> {
    const prepared = await prepareImage(file);
    try {
        return { prepared, rendered: await renderRegion(prepared, FULL_IMAGE, limits) };
    } finally {
        prepared.dispose();
    }
}
