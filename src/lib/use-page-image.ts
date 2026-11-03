"use client";

import { useEffect, useState } from "react";

/** 读取 data URL 图片的像素尺寸，用于按比例显示原图区域 */
export function usePageImage(url: string | null | undefined): { url: string; width: number; height: number } | null {
    const [size, setSize] = useState<{ url: string; width: number; height: number } | null>(null);
    useEffect(() => {
        if (!url) return;
        let cancelled = false;
        const image = new Image();
        image.onload = () => {
            if (!cancelled) setSize({ url, width: image.naturalWidth, height: image.naturalHeight });
        };
        image.src = url;
        return () => {
            cancelled = true;
        };
    }, [url]);
    return size && size.url === url ? size : null;
}
