"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import { figureSvgToDataUri } from "@/lib/figure-svg";
import { normalizeFigureScale } from "@/lib/figure-scale";
import { cn } from "@/lib/utils";

interface QuestionFigureProps {
    svg: string | null | undefined;
    scale?: number;
    className?: string;
}

/**
 * 题目的 SVG 配图。用 <img> 加载 data URI，SVG 中即使有脚本也不会执行；
 * 固定白色背景，深色模式和打印时黑色线条都清晰可见。
 */
export function QuestionFigure({ svg, scale, className }: QuestionFigureProps) {
    const { t } = useLanguage();
    if (!svg) return null;
    const figureScale = normalizeFigureScale(scale);
    return (
        <figure className={cn("question-figure my-3", className)}>
            <img
                src={figureSvgToDataUri(svg)}
                alt={t.figure.alt}
                className="mx-auto block h-auto max-w-full rounded border bg-white p-2"
                // zoom 同时改变显示尺寸和布局占位，打印时也生效；宽图缩小时同步收紧宽度上限。
                style={{ maxHeight: 360, zoom: figureScale / 100, maxWidth: `${Math.min(figureScale, 100)}%` }}
            />
        </figure>
    );
}
