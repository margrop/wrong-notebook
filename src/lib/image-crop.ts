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

/** 以图片宽高为 1 的相对坐标表示的矩形区域 */
export interface ImageRegion {
    x: number;
    y: number;
    width: number;
    height: number;
    /** 从原图渲染该区域时一并擦除的笔画（坐标相对整张图片） */
    erase?: EraseStroke[];
}

/** 规范化拖拽得到的两个角点为矩形，并限制在图片范围内 */
/** 待裁剪图片只来自本地文件生成的 blob/data 地址，其他地址一律不渲染 */
export function toSafeImageSrc(src: string): string | undefined {
    return /^(blob:|data:image\/)/i.test(src) ? src : undefined;
}

export function regionFromPoints(ax: number, ay: number, bx: number, by: number): ImageRegion {
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const x1 = clamp(Math.min(ax, bx));
    const y1 = clamp(Math.min(ay, by));
    const x2 = clamp(Math.max(ax, bx));
    const y2 = clamp(Math.max(ay, by));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** 把擦除笔画映射到输出画布，用白色覆盖做题笔迹（只影响裁剪后的图片） */
export function applyEraseStrokes(
    context: CanvasRenderingContext2D,
    strokes: EraseStroke[],
    source: { width: number; height: number },
    regionPixels: { sx: number; sy: number; sw: number; sh: number },
    output: { width: number; height: number },
): void {
    if (strokes.length === 0) return;
    const scaleX = output.width / regionPixels.sw;
    const scaleY = output.height / regionPixels.sh;
    context.save();
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#ffffff";
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const stroke of strokes) {
        if (stroke.points.length === 0) continue;
        const points = stroke.points.map((point) => ({
            x: (point.x * source.width - regionPixels.sx) * scaleX,
            y: (point.y * source.height - regionPixels.sy) * scaleY,
        }));
        const radius = Math.max(0.5, stroke.radius * source.width * scaleX);
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
/** 按原图分辨率裁剪出各区域，返回 JPEG 图片 */
export async function cropImageRegions(image: HTMLImageElement, regions: ImageRegion[]): Promise<Blob[]> {
    const { naturalWidth, naturalHeight } = image;
    return Promise.all(regions.map((region) => new Promise<Blob>((resolve, reject) => {
        const canvas = document.createElement("canvas");
        const sx = Math.round(region.x * naturalWidth);
        const sy = Math.round(region.y * naturalHeight);
        const sw = Math.max(1, Math.round(region.width * naturalWidth));
        const sh = Math.max(1, Math.round(region.height * naturalHeight));
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            reject(new Error("Canvas is not supported"));
            return;
        }
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
        applyEraseStrokes(ctx, region.erase ?? [], { width: naturalWidth, height: naturalHeight },
            { sx, sy, sw, sh }, { width: sw, height: sh });
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas is empty"))), "image/jpeg", 0.95);
    })));
}
