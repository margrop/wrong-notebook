/** 擦除笔画的一个点，坐标相对整张图片（0～1） */
export interface ErasePoint {
    x: number;
    y: number;
}

/** 覆盖做题笔迹的白色笔画；半径相对整张图片宽度 */
export interface EraseStroke {
    points: ErasePoint[];
    radius: number;
}

/** 裁剪前对原图顺时针旋转的角度（度） */
export const IMAGE_ROTATIONS = [0, 90, 180, 270] as const;
export type ImageRotation = typeof IMAGE_ROTATIONS[number];

/** 以图片宽高为 1 的相对坐标表示的矩形区域 */
export interface ImageRegion {
    x: number;
    y: number;
    width: number;
    height: number;
    /** 显示与裁剪时顺时针旋转的角度；坐标均相对旋转后的画面 */
    rotation?: ImageRotation;
    erase?: EraseStroke[];
}

/** 旋转后的画面尺寸；90/270 度时宽高互换 */
export function rotatedFrameSize(width: number, height: number, rotation: ImageRotation = 0) {
    const swapped = rotation === 90 || rotation === 270;
    return { width: swapped ? height : width, height: swapped ? width : height };
}

/** 裁剪几何：区域在旋转后画面中的像素矩形、对应的原图像素矩形，以及输出尺寸 */
export interface RotatedCropGeometry {
    rotation: ImageRotation;
    frameWidth: number;
    frameHeight: number;
    /** 区域在旋转后画面中的像素矩形 */
    fx: number; fy: number; fw: number; fh: number;
    /** 对应到原图的像素矩形 */
    sx: number; sy: number; sw: number; sh: number;
    outputWidth: number;
    outputHeight: number;
}

/** 把相对旋转画面的区域换算为原图裁剪矩形；越界坐标按画面边界裁剪 */
export function rotatedCropGeometry(sourceWidth: number, sourceHeight: number, region: ImageRegion): RotatedCropGeometry {
    const rotation: ImageRotation = (IMAGE_ROTATIONS as readonly number[]).includes(region.rotation ?? 0)
        ? region.rotation ?? 0
        : 0;
    const frame = rotatedFrameSize(sourceWidth, sourceHeight, rotation);
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const fx = Math.round(clamp(region.x) * frame.width);
    const fy = Math.round(clamp(region.y) * frame.height);
    const fw = Math.max(1, Math.min(frame.width - fx, Math.round(clamp(region.width) * frame.width)));
    const fh = Math.max(1, Math.min(frame.height - fy, Math.round(clamp(region.height) * frame.height)));
    let sx: number, sy: number, sw: number, sh: number;
    switch (rotation) {
        case 90:
            sx = fy; sy = frame.width - fx - fw; sw = fh; sh = fw;
            break;
        case 180:
            sx = sourceWidth - fx - fw; sy = sourceHeight - fy - fh; sw = fw; sh = fh;
            break;
        case 270:
            sx = sourceWidth - fy - fh; sy = fx; sw = fh; sh = fw;
            break;
        default:
            sx = fx; sy = fy; sw = fw; sh = fh;
    }
    return {
        rotation, frameWidth: frame.width, frameHeight: frame.height,
        fx, fy, fw, fh, sx, sy, sw, sh,
        outputWidth: fw, outputHeight: fh,
    };
}

/** 把旋转画面中的擦除笔画映射到输出画布 */
export function applyEraseStrokesToFrame(
    context: CanvasRenderingContext2D,
    strokes: EraseStroke[],
    frame: { width: number; height: number },
    region: { sx: number; sy: number; sw: number; sh: number },
    output: { width: number; height: number },
): void {
    if (strokes.length === 0) return;
    const scaleX = output.width / region.sw;
    const scaleY = output.height / region.sh;
    context.save();
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#ffffff";
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const stroke of strokes) {
        if (stroke.points.length === 0) continue;
        const points = stroke.points.map((point) => ({
            x: (point.x * frame.width - region.sx) * scaleX,
            y: (point.y * frame.height - region.sy) * scaleY,
        }));
        const radius = Math.max(0.5, stroke.radius * frame.width * scaleX);
        if (points.length === 1) {
            context.beginPath();
            context.arc(points[0].x, points[0].y, radius, 0, Math.PI * 2);
            context.fill();
            continue;
        }
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (const point of points.slice(1)) context.lineTo(point.x, point.y);
        context.lineWidth = radius * 2;
        context.stroke();
    }
    context.restore();
}

/** 按旋转角度把原图区域绘制到输出画布（白底），再绘制擦除笔画 */
export function drawRotatedCrop(
    context: CanvasRenderingContext2D,
    source: CanvasImageSource,
    geometry: RotatedCropGeometry,
    width: number,
    height: number,
    erase: EraseStroke[] = [],
): void {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.save();
    switch (geometry.rotation) {
        case 90:
            context.translate(width, 0);
            context.rotate(Math.PI / 2);
            break;
        case 180:
            context.translate(width, height);
            context.rotate(Math.PI);
            break;
        case 270:
            context.translate(0, height);
            context.rotate(-Math.PI / 2);
            break;
        default:
            break;
    }
    // 90/270 度时旋转坐标轴后，局部绘制尺寸为输出高、宽
    const swapped = geometry.rotation === 90 || geometry.rotation === 270;
    context.drawImage(source, geometry.sx, geometry.sy, geometry.sw, geometry.sh,
        0, 0, swapped ? height : width, swapped ? width : height);
    context.restore();
    applyEraseStrokesToFrame(context, erase,
        { width: geometry.frameWidth, height: geometry.frameHeight },
        { sx: geometry.fx, sy: geometry.fy, sw: geometry.fw, sh: geometry.fh },
        { width, height });
}

/** 规范化拖拽得到的两个角点为矩形，并限制在图片范围内 */
/** 待裁剪图片只来自本地文件生成的 blob/data 地址，其他地址一律不渲染 */
export function toSafeImageSrc(src: string): string | undefined {
    return /^(blob:|data:image\/)/i.test(src) ? src : undefined;
}

/** 把已保存的图片 data URL 还原为 Blob，供裁剪或上传时解码 */
export function blobFromDataUrl(dataUrl: string): Blob | null {
    const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([\s\S]+)$/);
    if (!match) return null;
    try {
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        return new Blob([bytes], { type: match[1] });
    } catch {
        return null;
    }
}

export function regionFromPoints(ax: number, ay: number, bx: number, by: number): ImageRegion {
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const x1 = clamp(Math.min(ax, bx));
    const y1 = clamp(Math.min(ay, by));
    const x2 = clamp(Math.max(ax, bx));
    const y2 = clamp(Math.max(ay, by));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** 把擦除笔画映射到输出画布（坐标相对整张图片或旋转后的画面） */
export function applyEraseStrokes(
    context: CanvasRenderingContext2D,
    strokes: EraseStroke[],
    source: { width: number; height: number },
    regionPixels: { sx: number; sy: number; sw: number; sh: number },
    output: { width: number; height: number },
): void {
    applyEraseStrokesToFrame(context, strokes, source, regionPixels, output);
}
/** 按原图分辨率裁剪出各区域，返回 JPEG 图片 */
export async function cropImageRegions(image: HTMLImageElement, regions: ImageRegion[]): Promise<Blob[]> {
    const { naturalWidth, naturalHeight } = image;
    return Promise.all(regions.map((region) => new Promise<Blob>((resolve, reject) => {
        const geometry = rotatedCropGeometry(naturalWidth, naturalHeight, region);
        const canvas = document.createElement("canvas");
        canvas.width = geometry.outputWidth;
        canvas.height = geometry.outputHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            reject(new Error("Canvas is not supported"));
            return;
        }
        drawRotatedCrop(ctx, image, geometry, geometry.outputWidth, geometry.outputHeight, region.erase ?? []);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas is empty"))), "image/jpeg", 0.95);
    })));
}
