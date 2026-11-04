import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
const BUTTON_STEP = 1.25;
// 滚轮每 100 像素的 deltaY 约缩放 16%
const WHEEL_SENSITIVITY = 0.0015;

const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

interface ZoomAnchor {
    /** 锚点相对滚动容器可视区左上角的位置 */
    viewX: number;
    viewY: number;
    /** 锚点在内容中的位置（缩放前） */
    contentX: number;
    contentY: number;
    ratio: number;
}

/**
 * 图片缩放：滚轮以光标为中心缩放、触屏双指捏合缩放、按钮缩放。
 * 通过改变图片显示尺寸（而非 CSS transform）实现，裁剪坐标随图片实际尺寸换算，无需额外处理。
 * 把返回的 containerRef 绑定到可滚动的图片容器；容器可能晚于组件挂载（如弹窗打开后），因此用回调 ref。
 * @param fitStyle 未缩放时图片的适应样式（如 maxHeight）
 */
export function useImageZoom(fitStyle: CSSProperties) {
    // state 用于在容器挂载后挂上原生监听；ref 用于直接读写滚动位置
    const [container, setContainer] = useState<HTMLElement | null>(null);
    const containerElRef = useRef<HTMLElement | null>(null);
    const containerRef = useCallback((element: HTMLElement | null) => {
        containerElRef.current = element;
        setContainer(element);
    }, []);
    const [zoom, setZoomState] = useState(MIN_ZOOM);
    const zoomRef = useRef(MIN_ZOOM);
    // 未缩放时图片的显示宽度，作为缩放基准
    const [baseWidth, setBaseWidth] = useState<number | null>(null);
    const anchorRef = useRef<ZoomAnchor | null>(null);
    // 双指捏合期间为 true，供外部阻止裁剪框跟随手指移动
    const pinchingRef = useRef(false);

    const zoomTo = useCallback((next: number, clientX?: number, clientY?: number) => {
        const container = containerElRef.current;
        const current = zoomRef.current;
        const target = clampZoom(next);
        if (!container || target === current) return;

        // 从 100% 开始缩放时重新测量适应尺寸（窗口大小可能已变化）
        if (current === MIN_ZOOM) {
            const image = container.querySelector("img");
            if (image) setBaseWidth(image.clientWidth);
        }
        const rect = container.getBoundingClientRect();
        const viewX = (clientX ?? rect.left + rect.width / 2) - rect.left;
        const viewY = (clientY ?? rect.top + rect.height / 2) - rect.top;
        anchorRef.current = {
            viewX,
            viewY,
            contentX: container.scrollLeft + viewX,
            contentY: container.scrollTop + viewY,
            ratio: target / current,
        };
        zoomRef.current = target;
        setZoomState(target);
    }, []);

    // 尺寸更新后调整滚动位置，让锚点停留在原处
    useLayoutEffect(() => {
        const container = containerElRef.current;
        const anchor = anchorRef.current;
        if (!container || !anchor) return;
        container.scrollLeft = anchor.contentX * anchor.ratio - anchor.viewX;
        container.scrollTop = anchor.contentY * anchor.ratio - anchor.viewY;
        anchorRef.current = null;
    }, [zoom]);

    // 滚轮与双指捏合需要阻止浏览器默认行为，只能用非 passive 的原生监听
    useEffect(() => {
        if (!container) return;

        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            zoomTo(zoomRef.current * Math.exp(-event.deltaY * WHEEL_SENSITIVITY), event.clientX, event.clientY);
        };

        let pinch: { distance: number; zoom: number } | null = null;
        const touchInfo = (touches: TouchList) => {
            const [a, b] = [touches[0], touches[1]];
            return {
                distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
                centerX: (a.clientX + b.clientX) / 2,
                centerY: (a.clientY + b.clientY) / 2,
            };
        };
        const handleTouchStart = (event: TouchEvent) => {
            if (event.touches.length !== 2) return;
            pinch = { distance: touchInfo(event.touches).distance, zoom: zoomRef.current };
            pinchingRef.current = true;
        };
        const handleTouchMove = (event: TouchEvent) => {
            if (!pinch || event.touches.length !== 2) return;
            event.preventDefault();
            const { distance, centerX, centerY } = touchInfo(event.touches);
            if (pinch.distance > 0) zoomTo(pinch.zoom * (distance / pinch.distance), centerX, centerY);
        };
        const handleTouchEnd = (event: TouchEvent) => {
            if (event.touches.length < 2) {
                pinch = null;
                pinchingRef.current = false;
            }
        };
        // 捏合时拦截指针移动，避免裁剪框或框选随第一根手指移动
        const handlePointerMove = (event: PointerEvent) => {
            if (pinchingRef.current) event.stopPropagation();
        };

        container.addEventListener("wheel", handleWheel, { passive: false });
        container.addEventListener("touchstart", handleTouchStart, { passive: true });
        container.addEventListener("touchmove", handleTouchMove, { passive: false });
        container.addEventListener("touchend", handleTouchEnd);
        container.addEventListener("touchcancel", handleTouchEnd);
        container.addEventListener("pointermove", handlePointerMove, { capture: true });
        return () => {
            container.removeEventListener("wheel", handleWheel);
            container.removeEventListener("touchstart", handleTouchStart);
            container.removeEventListener("touchmove", handleTouchMove);
            container.removeEventListener("touchend", handleTouchEnd);
            container.removeEventListener("touchcancel", handleTouchEnd);
            container.removeEventListener("pointermove", handlePointerMove, { capture: true });
        };
    }, [container, zoomTo]);

    /** 图片加载完成或回到 100% 时记录适应尺寸 */
    const measureImage = useCallback((image: HTMLImageElement | null) => {
        if (image && zoomRef.current === MIN_ZOOM) setBaseWidth(image.clientWidth);
    }, []);

    const zoomIn = useCallback(() => zoomTo(zoomRef.current * BUTTON_STEP), [zoomTo]);
    const zoomOut = useCallback(() => zoomTo(zoomRef.current / BUTTON_STEP), [zoomTo]);

    const reset = useCallback(() => {
        zoomRef.current = MIN_ZOOM;
        anchorRef.current = null;
        setZoomState(MIN_ZOOM);
    }, []);

    const imageStyle: CSSProperties = zoom === MIN_ZOOM || !baseWidth
        ? fitStyle
        : { ...fitStyle, width: baseWidth * zoom, height: "auto", maxWidth: "none", maxHeight: "none" };

    return {
        containerRef,
        zoom,
        imageStyle,
        measureImage,
        zoomIn,
        zoomOut,
        reset,
    };
}
