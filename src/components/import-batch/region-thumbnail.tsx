"use client";

import { boundingRegion } from "@/lib/question-split/draft";
import type { DraftRegion } from "@/lib/question-split/draft";
import { cn } from "@/lib/utils";

interface RegionThumbnailProps {
    imageUrl: string;
    /** 整页图片的宽高（像素），用于保持裁片比例 */
    imageSize: { width: number; height: number };
    regions: DraftRegion[];
    className?: string;
}

/** 用整页图显示一道题所在区域（多个区域时显示外接矩形），不额外生成图片 */
export function RegionThumbnail({ imageUrl, imageSize, regions, className }: RegionThumbnailProps) {
    const box = boundingRegion(regions);
    if (!box) return null;
    const aspect = (box.width * imageSize.width) / Math.max(1, box.height * imageSize.height);
    return (
        <div
            className={cn("relative w-full overflow-hidden rounded-md border bg-white", className)}
            style={{ aspectRatio: String(Math.max(0.25, Math.min(8, aspect))) }}
            aria-hidden
        >
            <img
                src={imageUrl}
                alt=""
                className="absolute max-w-none select-none"
                draggable={false}
                style={{
                    width: `${100 / box.width}%`,
                    height: `${100 / box.height}%`,
                    left: `${(-box.x / box.width) * 100}%`,
                    top: `${(-box.y / box.height) * 100}%`,
                }}
            />
        </div>
    );
}
