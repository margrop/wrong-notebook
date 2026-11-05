"use client";

import { useEffect, useState, useRef } from "react";
import type { CSSProperties } from "react";
import ReactCrop from "react-image-crop";
import type { Crop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RegionSelector } from "@/components/region-selector";
import { ZoomControls } from "@/components/zoom-controls";
import { useLanguage } from "@/contexts/LanguageContext";
import { cropImageRegions, toSafeImageSrc } from "@/lib/image-crop";
import type { ImageRegion } from "@/lib/image-crop";
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
}

export function ImageCropper({ imageSrc, open, onClose, onCropComplete, onMultiCropComplete, onRegionsSelected, allowMulti = true, onAutoSplit, onAddPart, partCount = 0 }: ImageCropperProps) {
    const { t } = useLanguage();
    const safeImageSrc = toSafeImageSrc(imageSrc);
    // 始终保存百分比坐标，缩放改变图片显示尺寸后仍然准确
    const [crop, setCrop] = useState<Crop>();
    const imgRef = useRef<HTMLImageElement>(null);
    // 记住上次选的模式；本裁剪框不提供该模式（如已有暂存分段时没有自动分题）时用单题裁剪
    const [savedMode, saveMode] = useStoredChoice<CropMode>(CROP_MODE_STORAGE_KEY, CROP_MODES, "single");
    const multiEnabled = !!onMultiCropComplete || (!!onRegionsSelected && allowMulti);
    const modes: CropMode[] = ["single", ...(onAutoSplit ? ["auto" as const] : []), ...(multiEnabled ? ["multi" as const] : [])];
    const mode: CropMode = modes.includes(savedMode) ? savedMode : "single";
    const { containerRef, zoom, imageStyle, measureImage, zoomIn, zoomOut, reset: resetZoom } = useImageZoom(FIT_STYLE[mode]);
    // 换图后回到 100%
    useEffect(() => {
        resetZoom();
    }, [imageSrc, resetZoom]);
    const setMode = (next: CropMode) => {
        resetZoom();
        saveMode(next);
    };
    // 框选结果与图片绑定，换图后自动清空
    const [regionState, setRegionState] = useState<{ src: string; regions: ImageRegion[] }>({ src: imageSrc, regions: [] });
    const regions = regionState.src === imageSrc ? regionState.regions : [];
    const setRegions = (next: ImageRegion[]) => setRegionState({ src: imageSrc, regions: next });
    const multiImgRef = useRef<HTMLImageElement>(null);

    const modeLabel: Record<CropMode, string> = { single: t.batchImport.singleMode, auto: t.batchImport.autoMode, multi: t.batchImport.multiMode };
    const handleMultiConfirm = async () => {
        if (regions.length === 0) return;
        if (onRegionsSelected) {
            onRegionsSelected(regions, true);
            setRegions([]);
            return;
        }
        if (!multiImgRef.current || !onMultiCropComplete) return;
        try {
            onMultiCropComplete(await cropImageRegions(multiImgRef.current, regions));
            setRegions([]);
        } catch (e) {
            frontendLogger.error('[ImageCropper]', 'Multi-image crop failed', { error: e });
        }
    };

    function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
        // 默认框选整张图片，不拖动直接确认即为整图
        setCrop({ unit: '%', x: 0, y: 0, width: 100, height: 100 });
        measureImage(e.currentTarget);
    }

    // 没有有效选框（如只点了一下）时使用整张图片
    const selectedRegion = (): ImageRegion => (crop && crop.width > 0 && crop.height > 0
        ? { x: crop.x / 100, y: crop.y / 100, width: crop.width / 100, height: crop.height / 100 }
        : { x: 0, y: 0, width: 1, height: 1 });

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
            const [croppedBlob] = await cropImageRegions(imgRef.current, [region]);
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
                                    imageSrc={safeImageSrc}
                                    regions={regions}
                                    onChange={setRegions}
                                    imageStyle={imageStyle}
                                    onImageLoad={(e) => measureImage(e.currentTarget)}
                                />
                            ) : (
                                <ReactCrop crop={crop} onChange={(_, percentCrop) => setCrop(percentCrop)}>
                                    <img
                                        ref={imgRef}
                                        alt="Crop me"
                                        src={safeImageSrc}
                                        onLoad={onImageLoad}
                                        style={imageStyle}
                                    />
                                </ReactCrop>
                            )}
                        </div>
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
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                        <p className="text-sm text-muted-foreground">
                            {mode === "multi"
                                ? `${t.batchImport.hint} ${t.batchImport.regionCount.replace("{count}", String(regions.length))}`
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
