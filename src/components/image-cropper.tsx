"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import type { CSSProperties } from "react";
import { Eraser, RotateCcw, RotateCw, Trash2, Undo2 } from "lucide-react";
import ReactCrop from "react-image-crop";
import type { Crop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RegionSelector } from "@/components/region-selector";
import { ZoomControls } from "@/components/zoom-controls";
import { useLanguage } from "@/contexts/LanguageContext";
import { applyEraseStrokes, cropImageRegions, drawRotatedCrop, rotatedCropGeometry, rotatedFrameSize, toSafeImageSrc } from "@/lib/image-crop";
import type { EraseStroke, ImageRegion, ImageRotation } from "@/lib/image-crop";
import { frontendLogger } from "@/lib/frontend-logger";
import { useImageZoom } from "@/lib/hooks/use-image-zoom";
import { useStoredChoice } from "@/lib/hooks/use-stored-choice";
import { CROP_MODE_STORAGE_KEY, CROP_MODES } from "@/lib/ui-preferences";
import type { CropMode } from "@/lib/ui-preferences";


// 未缩放时图片适应弹窗的尺寸
const FIT_STYLE: Record<CropMode, CSSProperties> = {
    single: { maxHeight: "70vh", maxWidth: "100%", objectFit: "contain" },
    auto: { maxHeight: "65vh", maxWidth: "100%", objectFit: "contain" },
    multi: { maxHeight: "65vh", maxWidth: "100%", objectFit: "contain" },
};
// 裁剪手柄最多向图片下边外伸出 12px，为它预留 16px
const BOTTOM_HANDLE_SPACE = 16;
// 擦除画笔按屏幕像素定义，涂抹时换算为相对图片宽度的半径，缩放后仍保持手感一致
const BRUSH_SIZES = [
    { key: "thin", pixels: 3 },
    { key: "medium", pixels: 7 },
    { key: "thick", pixels: 14 },
] as const;
type BrushSize = (typeof BRUSH_SIZES)[number]["key"];

interface ImageCropperProps {
    imageSrc: string;
    open: boolean;
    onClose: () => void;
    /** 返回按显示图片裁剪出的图片（预览图即原图时使用） */
    onCropComplete?: (croppedImageBlob: Blob) => void;
    /** 提供时显示「多题框选」模式，返回每个框裁剪出的图片 */
    onMultiCropComplete?: (croppedImageBlobs: Blob[]) => void;
    /**
     * 提供时只返回相对坐标（0～1），由调用方从原图裁剪：预览使用缩略图时，保证裁剪结果保留原图分辨率。
     * multi 为 true 表示多题框选，此时也会显示「多题框选」模式。
     */
    onRegionsSelected?: (regions: ImageRegion[], multi: boolean) => void;
    /** 与 onRegionsSelected 一起使用时是否提供多题框选，默认提供 */
    allowMulti?: boolean;
    /** 提供时显示「自动分题」模式：返回所框的试卷区域（相对坐标），由 AI 识别其中的每道题 */
    onAutoSplit?: (region: ImageRegion) => void;
    /** 单题模式下提供「下一段在另一张」：返回这一段的区域，由调用方暂存后继续选下一张 */
    onAddPart?: (region: ImageRegion) => void;
    /** 已暂存的段数：大于 0 时本张是后续段，确认后与前面各段拼成一题 */
    partCount?: number;
    /** 提供「擦除做题痕迹」画笔，裁剪结果一并擦除；默认提供 */
    eraseEnabled?: boolean;
}

export function ImageCropper({ imageSrc, open, onClose, onCropComplete, onMultiCropComplete, onRegionsSelected, allowMulti = true, onAutoSplit, onAddPart, partCount = 0, eraseEnabled = true }: ImageCropperProps) {
    const { t } = useLanguage();
    const safeImageSrc = toSafeImageSrc(imageSrc);
    // 旋转角度与图片绑定，换图后回到 0 度，无需在 effect 中同步重置
    const [rotationState, setRotationState] = useState<{ src: string | undefined; rotation: ImageRotation }>({ src: imageSrc, rotation: 0 });
    const rotation = rotationState.src === imageSrc ? rotationState.rotation : 0;
    const setRotation = (next: ImageRotation) => setRotationState({ src: imageSrc, rotation: next });
    const [rotatedCache, setRotatedCache] = useState<{ src: string | undefined; rotation: ImageRotation; url: string } | null>(null);
    const rotatedSrc = rotation === 0
        ? safeImageSrc
        : (rotatedCache && rotatedCache.src === safeImageSrc && rotatedCache.rotation === rotation ? rotatedCache.url : safeImageSrc);
    // 旋转预览：裁剪坐标相对旋转后的画面，最终从原图按同一角度裁剪
    useEffect(() => {
        if (!safeImageSrc || rotation === 0) return;
        let cancelled = false;
        let objectUrl: string | null = null;
        const image = new Image();
        image.decoding = "async";
        image.src = safeImageSrc;
        image.decode().then(() => {
            if (cancelled) return;
            const geometry = rotatedCropGeometry(image.naturalWidth, image.naturalHeight,
                { x: 0, y: 0, width: 1, height: 1, rotation });
            const frame = rotatedFrameSize(image.naturalWidth, image.naturalHeight, rotation);
            const canvas = document.createElement("canvas");
            canvas.width = frame.width;
            canvas.height = frame.height;
            const context = canvas.getContext("2d");
            if (!context) return;
            drawRotatedCrop(context, image, geometry, frame.width, frame.height);
            canvas.toBlob((blob) => {
                if (!blob || cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setRotatedCache({ src: safeImageSrc, rotation, url: objectUrl });
            }, "image/jpeg", 0.9);
        }).catch((error: unknown) => {
            frontendLogger.warn("[ImageCropper]", "Rotate preview failed", { error });
        });
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [safeImageSrc, rotation]);
    // 始终保存百分比坐标，缩放改变图片显示尺寸后仍然准确
    const [crop, setCrop] = useState<Crop>();
    const imgRef = useRef<HTMLImageElement>(null);
    // 记住上次选的模式；本裁剪框不提供该模式（如已有暂存分段时没有自动分题）时用单题裁剪
    const [savedMode, saveMode] = useStoredChoice<CropMode>(CROP_MODE_STORAGE_KEY, CROP_MODES, "single");
    const multiEnabled = !!onMultiCropComplete || (!!onRegionsSelected && allowMulti);
    const modes: CropMode[] = ["single", ...(onAutoSplit ? ["auto" as const] : []), ...(multiEnabled ? ["multi" as const] : [])];
    const mode: CropMode = modes.includes(savedMode) ? savedMode : "single";
    // 高度按实际图片区测量，不按视口高度估算
    const [fitHeight, setFitHeight] = useState<number | null>(null);
    const fitStyle = fitHeight === null ? FIT_STYLE[mode] : { ...FIT_STYLE[mode], maxHeight: `${Math.max(0, fitHeight - BOTTOM_HANDLE_SPACE)}px` };
    const { containerRef, container, zoom, imageStyle, measureImage, zoomIn, zoomOut, reset: resetZoom } = useImageZoom(fitStyle);
    // 换图后回到 100%
    useEffect(() => {
        resetZoom();
    }, [imageSrc, resetZoom]);
    // 图片区随弹窗、底部工具栏与窗口尺寸变化，按实际内容高度收紧图片，保证选框下边线可见
    useEffect(() => {
        if (!container) return;
        const observer = new ResizeObserver(([entry]) => setFitHeight(entry.contentRect.height));
        observer.observe(container);
        return () => observer.disconnect();
    }, [container]);
    // 适应高度改变后图片宽度也改变，重新记录 100% 时的缩放基准
    useEffect(() => {
        const image = container?.querySelector("img");
        measureImage(image instanceof HTMLImageElement ? image : null);
    }, [container, fitStyle.maxHeight, zoom, measureImage]);
    const setMode = (next: CropMode) => {
        resetZoom();
        saveMode(next);
        if (next === "multi") {
            setErasing(false);
            setStrokes([]);
        }
    };
    // 框选结果与图片绑定，换图后自动清空
    const [regionState, setRegionState] = useState<{ src: string; regions: ImageRegion[] }>({ src: imageSrc, regions: [] });
    const regions = regionState.src === imageSrc ? regionState.regions : [];
    const setRegions = (next: ImageRegion[]) => setRegionState({ src: imageSrc, regions: next });
    const multiImgRef = useRef<HTMLImageElement>(null);
    // 擦除笔画与图片绑定，换图后清空；坐标相对整张图片，供调用方从原图渲染时应用
    const [eraseState, setEraseState] = useState<{ src: string; strokes: EraseStroke[] }>({ src: imageSrc, strokes: [] });
    const strokes = useMemo(() => (eraseState.src === imageSrc ? eraseState.strokes : []), [eraseState, imageSrc]);
    const setStrokes = (next: EraseStroke[] | ((current: EraseStroke[]) => EraseStroke[])) =>
        setEraseState((current) => ({ src: imageSrc, strokes: typeof next === "function" ? next(current.strokes) : next }));
    const rotate = (delta: 90 | -90) => {
        const next = ((rotation + delta) % 360 + 360) % 360;
        setRotation(next as ImageRotation);
        setCrop(undefined);
        setRegions([]);
        setStrokes([]);
        resetZoom();
    };
    const [erasing, setErasing] = useState(false);
    const [brushSize, setBrushSize] = useState<BrushSize>("medium");
    const [imageReady, setImageReady] = useState(0);
    const eraseCanvasRef = useRef<HTMLCanvasElement>(null);
    const strokeIndexRef = useRef<number | null>(null);

    // 预览画布按显示尺寸重绘擦除笔画；缩放或换图后坐标仍按图片宽高归一化
    useEffect(() => {
        if (!eraseEnabled || mode === "multi") return;
        const canvas = eraseCanvasRef.current;
        const image = imgRef.current;
        if (!canvas || !image || image.clientWidth === 0) return;
        canvas.width = image.clientWidth;
        canvas.height = image.clientHeight;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        applyEraseStrokes(context, strokes, { width: canvas.width, height: canvas.height },
            { sx: 0, sy: 0, sw: canvas.width, sh: canvas.height }, { width: canvas.width, height: canvas.height });
    }, [eraseEnabled, mode, strokes, imageReady, zoom, imageSrc, fitStyle.maxHeight]);

    useEffect(() => {
        setErasing(false);
        strokeIndexRef.current = null;
    }, [imageSrc]);

    const brushPixels = BRUSH_SIZES.find((size) => size.key === brushSize)?.pixels ?? 7;

    const erasePoint = (event: React.PointerEvent) => {
        const rect = eraseCanvasRef.current!.getBoundingClientRect();
        return {
            x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
            y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
        };
    };

    const handleEraseDown = (event: React.PointerEvent) => {
        if (!erasing || event.button !== 0) return;
        event.preventDefault();
        eraseCanvasRef.current?.setPointerCapture(event.pointerId);
        const canvas = eraseCanvasRef.current;
        strokeIndexRef.current = strokes.length;
        setStrokes([...strokes, { points: [erasePoint(event)], radius: canvas ? brushPixels / canvas.clientWidth : 0.006 }]);
    };

    const handleEraseMove = (event: React.PointerEvent) => {
        const index = strokeIndexRef.current;
        if (index === null) return;
        const point = erasePoint(event);
        setStrokes((current) => current.map((stroke, i) => {
            if (i !== index) return stroke;
            const last = stroke.points[stroke.points.length - 1];
            if (last && Math.abs(last.x - point.x) < 0.0005 && Math.abs(last.y - point.y) < 0.0005) return stroke;
            return { ...stroke, points: [...stroke.points, point] };
        }));
    };

    const handleEraseUp = () => {
        strokeIndexRef.current = null;
    };

    const modeLabel: Record<CropMode, string> = { single: t.batchImport.singleMode, auto: t.batchImport.autoMode, multi: t.batchImport.multiMode };
    const brushLabel: Record<BrushSize, string> = { thin: t.common.cropper.brushThin, medium: t.common.cropper.brushMedium, thick: t.common.cropper.brushThick };
    const handleMultiConfirm = async () => {
        if (regions.length === 0) return;
        if (onRegionsSelected) {
            onRegionsSelected(regions.map((region) => ({ ...region, rotation })), true);
            setRegions([]);
            return;
        }
        if (!multiImgRef.current || !onMultiCropComplete) return;
        try {
            onMultiCropComplete(await cropImageRegions(multiImgRef.current, regions.map((region) => ({ ...region, rotation: 0 }))));
            setRegions([]);
        } catch (e) {
            frontendLogger.error('[ImageCropper]', 'Multi-image crop failed', { error: e });
        }
    };

    function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
        // 默认框选整张图片，不拖动直接确认即为整图
        setCrop({ unit: '%', x: 0, y: 0, width: 100, height: 100 });
        measureImage(e.currentTarget);
        setImageReady((value) => value + 1);
    }

    // 没有有效选框（如只点了一下）时使用整张图片
    const selectedRegion = (): ImageRegion => {
        const base = crop && crop.width > 0 && crop.height > 0
            ? { x: crop.x / 100, y: crop.y / 100, width: crop.width / 100, height: crop.height / 100 }
            : { x: 0, y: 0, width: 1, height: 1 };
        return { ...base, rotation, ...(strokes.length ? { erase: strokes } : {}) };
    };

    const handleConfirm = async () => {
        const region = selectedRegion();
        if (mode === "auto" && onAutoSplit) {
            onAutoSplit(region);
            return;
        }
        if (onRegionsSelected) {
            onRegionsSelected([region], false);
            return;
        }
        if (!imgRef.current || !onCropComplete) return;
        try {
            const [croppedBlob] = await cropImageRegions(imgRef.current, [{ ...region, rotation: 0 }]);
            onCropComplete(croppedBlob);
        } catch (e) {
            frontendLogger.error('[ImageCropper]', 'Crop failed', { error: e });
        }
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-3xl h-[90vh] flex flex-col p-0 gap-0">
                <DialogHeader className="p-4 border-b shrink-0">
                    <DialogTitle>{t.common.cropper?.title || "Crop Image"}</DialogTitle>
                </DialogHeader>

                <div className="relative min-h-0 flex-1 bg-black">
                    {/* m-auto 居中：图片放大超出容器后仍能滚动到左上角 */}
                    <div ref={containerRef} className="flex h-full w-full overflow-auto p-4">
                        <div className="m-auto">
                            {mode === "multi" ? (
                                <RegionSelector
                                    ref={multiImgRef}
                                    imageSrc={rotatedSrc}
                                    regions={regions}
                                    onChange={setRegions}
                                    imageStyle={imageStyle}
                                    onImageLoad={(e) => measureImage(e.currentTarget)}
                                />
                            ) : (
                                <div className="relative inline-block select-none">
                                    <ReactCrop crop={crop} onChange={(_, percentCrop) => setCrop(percentCrop)} disabled={erasing}>
                                        <img
                                            ref={imgRef}
                                            alt="Crop me"
                                            src={rotatedSrc}
                                            onLoad={onImageLoad}
                                            style={imageStyle}
                                            className="block"
                                        />
                                    </ReactCrop>
                                    {eraseEnabled && (
                                        <canvas
                                            ref={eraseCanvasRef}
                                            aria-hidden
                                            className={`absolute inset-0 ${erasing ? "cursor-crosshair" : "pointer-events-none"}`}
                                            style={{ touchAction: "none" }}
                                            onPointerDown={handleEraseDown}
                                            onPointerMove={handleEraseMove}
                                            onPointerUp={handleEraseUp}
                                            onPointerCancel={handleEraseUp}
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="absolute left-3 top-3 flex gap-1 rounded-md bg-background/90 p-1 shadow-sm">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => rotate(-90)} aria-label={t.common.cropper.rotateLeft} title={t.common.cropper.rotateLeft}>
                            <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => rotate(90)} aria-label={t.common.cropper.rotateRight} title={t.common.cropper.rotateRight}>
                            <RotateCw className="h-4 w-4" />
                        </Button>
                    </div>
                    <div className="absolute right-3 top-3">
                        <ZoomControls zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={resetZoom} />
                    </div>
                </div>

                <div className="p-4 border-t bg-background shrink-0 space-y-3">
                    {modes.length > 1 && (
                        <div className={`grid gap-1 rounded-md bg-muted p-1 ${modes.length === 3 ? "grid-cols-3 sm:w-[28rem]" : "grid-cols-2 sm:w-80"}`}>
                            {modes.map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    aria-pressed={mode === value}
                                    onClick={() => setMode(value)}
                                    className={`rounded px-2 py-1.5 text-sm font-medium transition-colors ${mode === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                                >
                                    {modeLabel[value]}
                                </button>
                            ))}
                        </div>
                    )}
                    {eraseEnabled && mode !== "multi" && (
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                variant={erasing ? "secondary" : "outline"}
                                size="sm"
                                onClick={() => {
                                    setErasing((value) => !value);
                                    strokeIndexRef.current = null;
                                }}
                                className="flex items-center gap-2"
                            >
                                <Eraser className="h-4 w-4" />
                                {erasing ? t.common.cropper.eraseDone : t.common.cropper.erase}
                            </Button>
                            {erasing && (
                                <>
                                    <div className="flex gap-1 rounded-md bg-muted p-1">
                                        {BRUSH_SIZES.map(({ key }) => (
                                            <button
                                                key={key}
                                                type="button"
                                                aria-pressed={brushSize === key}
                                                onClick={() => setBrushSize(key)}
                                                className={`rounded px-2 py-1 text-xs font-medium ${brushSize === key ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                                            >
                                                {brushLabel[key]}
                                            </button>
                                        ))}
                                    </div>
                                    {strokes.length > 0 && (
                                        <>
                                            <Button variant="ghost" size="sm" onClick={() => setStrokes(strokes.slice(0, -1))} className="flex items-center gap-1.5">
                                                <Undo2 className="h-4 w-4" />
                                                {t.common.cropper.undoErase}
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => setStrokes([])} className="flex items-center gap-1.5">
                                                <Trash2 className="h-4 w-4" />
                                                {t.common.cropper.clearErase}
                                            </Button>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                        <p className="text-sm text-muted-foreground">
                            {mode === "multi"
                                ? `${t.batchImport.hint} ${t.batchImport.regionCount.replace("{count}", String(regions.length))}`
                                : erasing ? t.common.cropper.eraseHint
                                : mode === "auto" ? t.batchImport.autoHint
                                : partCount > 0 ? t.upload.parts.cropHint.replace("{n}", String(partCount + 1))
                                : (t.common.cropper?.hint || "💡 Drag to adjust crop area")}
                        </p>
                        <div className="flex flex-wrap gap-2 justify-end">
                            {mode === "multi" && regions.length > 0 && (
                                <Button variant="ghost" onClick={() => setRegions([])}>
                                    {t.batchImport.clear}
                                </Button>
                            )}
                            <Button variant="outline" onClick={onClose}>
                                {t.common.cancel || "Cancel"}
                            </Button>
                            {mode === "multi" ? (
                                <Button onClick={handleMultiConfirm} disabled={regions.length === 0}>
                                    {t.batchImport.start.replace("{count}", String(regions.length))}
                                </Button>
                            ) : (
                                <>
                                    {mode === "single" && onAddPart && (
                                        <Button variant="secondary" onClick={() => onAddPart(selectedRegion())} data-testid="crop-add-part">
                                            {t.upload.parts.addNext}
                                        </Button>
                                    )}
                                    <Button onClick={handleConfirm}>
                                        {mode === "auto" ? t.batchImport.autoStart
                                            : partCount > 0 ? t.upload.parts.confirm.replace("{count}", String(partCount + 1))
                                            : (t.common.confirm || "Confirm")}
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
