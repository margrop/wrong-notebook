"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import { figureSvgToDataUri } from "@/lib/figure-svg";
import { normalizeFigureAlign, normalizeFigureScale } from "@/lib/figure-scale";
import type { FigureAlign } from "@/lib/figure-scale";
import { cn } from "@/lib/utils";

interface QuestionFigureProps {
    svg: string | null | undefined;
    scale?: number;
    /** 识别时裁剪的原配图（PNG data URI）；化学结构式等复杂图形可切换为原图显示 */
    image?: string | null;
    /** 显示来源：svg（AI 重绘，默认）| image（裁剪原图） */
    source?: string | null;
    align?: FigureAlign | string | null;
    className?: string;
}

const ALIGN_CLASS: Record<FigureAlign, string> = {
    left: "mr-auto",
    center: "mx-auto",
    right: "ml-auto",
};

/**
 * 题目的配图。用 <img> 加载 data URI，SVG 中即使有脚本也不会执行；
 * 固定白色背景，深色模式和打印时黑色线条都清晰可见。选择原图或 SVG 缺失时显示裁剪原图。
 */
export function QuestionFigure({ svg, image, source, scale, align, className }: QuestionFigureProps) {
    const { t } = useLanguage();
    const useImage = Boolean(image) && (source === "image" || !svg);
    const src = useImage ? image : svg ? figureSvgToDataUri(svg) : image ?? null;
    if (!src) return null;
    const figureScale = normalizeFigureScale(scale);
    const figureAlign = normalizeFigureAlign(align);
    const alignMargin = figureAlign === "left"
        ? { marginLeft: 0, marginRight: "auto" }
        : figureAlign === "right"
            ? { marginLeft: "auto", marginRight: 0 }
            : {};
    return (
        <figure className={cn("question-figure my-3", className)}>
            <img
                src={src}
                alt={t.figure.alt}
                className={cn(ALIGN_CLASS[figureAlign], "block h-auto max-w-full rounded border bg-white p-2")}
                // zoom 同时改变显示尺寸和布局占位，打印时也生效；宽图缩小时同步收紧宽度上限。
                style={{ ...alignMargin, maxHeight: 360, zoom: figureScale / 100, maxWidth: `${Math.min(figureScale, 100)}%` }}
            />
        </figure>
    );
}
