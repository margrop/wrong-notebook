"use client";

import { useEffect, useState } from "react";

export interface BatchPageView {
    page: number;
    url: string;
    width: number;
    height: number;
}

/** 读取多页批次各页 data URL 图片的像素尺寸（按页码升序）；全部解码完成前返回 null */
export function usePageImages(pages: Array<{ page: number; dataUrl: string }> | null | undefined): BatchPageView[] | null {
    const [views, setViews] = useState<{ key: string; views: BatchPageView[] } | null>(null);
    const key = pages?.map((page) => `${page.page}:${page.dataUrl.length}`).join("|") ?? "";
    useEffect(() => {
        if (!pages?.length) return;
        let cancelled = false;
        Promise.all(pages.map((page) => {
            const { promise, resolve, reject } = Promise.withResolvers<BatchPageView>();
            const image = new Image();
            image.onload = () => resolve({ page: page.page, url: page.dataUrl, width: image.naturalWidth, height: image.naturalHeight });
            image.onerror = () => reject(new Error("IMAGE_DECODE_FAILED"));
            image.src = page.dataUrl;
            return promise;
        })).then((loaded) => {
            if (!cancelled) setViews({ key, views: loaded.sort((a, b) => a.page - b.page) });
        }).catch(() => {
            if (!cancelled) setViews({ key, views: [] });
        });
        return () => {
            cancelled = true;
        };
        // key 由页码与内容长度组成，页图变化时重新解码
        // eslint-disable-next-line react-hooks/exhaustive-deps -- pages 数组每次轮询都是新引用，按 key 判断内容变化
    }, [key]);
    if (!pages?.length) return null;
    return views && views.key === key ? views.views : null;
}
