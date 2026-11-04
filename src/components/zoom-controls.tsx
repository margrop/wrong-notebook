"use client";

import { ZoomIn, ZoomOut } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { MAX_ZOOM, MIN_ZOOM } from "@/lib/hooks/use-image-zoom";

interface ZoomControlsProps {
    zoom: number;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onReset: () => void;
}

/** 悬浮在图片区域上的缩小 / 当前比例（点击还原）/ 放大按钮 */
export function ZoomControls({ zoom, onZoomIn, onZoomOut, onReset }: ZoomControlsProps) {
    const { t } = useLanguage();
    const focusClass = "outline-none focus-visible:ring-2 focus-visible:ring-white/70";
    const buttonClass = `flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-transparent ${focusClass}`;

    return (
        <div className="flex items-center gap-0.5 rounded-full bg-black/60 p-1 shadow-lg backdrop-blur-sm">
            <button type="button" className={buttonClass} onClick={onZoomOut} disabled={zoom <= MIN_ZOOM} aria-label={t.common.cropper.zoomOut} title={t.common.cropper.zoomOut}>
                <ZoomOut className="h-4 w-4" />
            </button>
            <button
                type="button"
                className={`h-9 min-w-14 rounded-full px-2 text-center text-xs font-medium tabular-nums text-white hover:bg-white/20 ${focusClass}`}
                onClick={onReset}
                aria-label={t.common.cropper.resetZoom}
                title={t.common.cropper.resetZoom}
            >
                {Math.round(zoom * 100)}%
            </button>
            <button type="button" className={buttonClass} onClick={onZoomIn} disabled={zoom >= MAX_ZOOM} aria-label={t.common.cropper.zoomIn} title={t.common.cropper.zoomIn}>
                <ZoomIn className="h-4 w-4" />
            </button>
        </div>
    );
}
