/**
 * 图片缩放：按钮、滚轮、双指捏合与还原
 */
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ZOOM, useImageZoom } from '@/lib/hooks/use-image-zoom';

type Zoom = ReturnType<typeof useImageZoom>;
const FIT = { maxHeight: '70vh', maxWidth: '100%' };

let root: Root;
let host: HTMLDivElement;
let zoom: Zoom;

// 每次渲染后把 hook 的最新返回值交给测试
function Probe({ onRender }: { onRender: (value: Zoom) => void }) {
    const value = useImageZoom(FIT);
    const { containerRef, imageStyle } = value;
    useEffect(() => onRender(value));
    return (
        <div ref={containerRef} data-testid="scroll">
            <img alt="" style={imageStyle} />
        </div>
    );
}

const scrollEl = () => host.querySelector<HTMLDivElement>('[data-testid="scroll"]')!;

function touchEvent(type: string, points: Array<[number, number]>) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const touches = points.map(([clientX, clientY]) => ({ clientX, clientY }));
    Object.defineProperty(event, 'touches', { value: touches });
    return event;
}

async function dispatch(event: Event) {
    await act(async () => { scrollEl().dispatchEvent(event); });
}

beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    // jsdom 不做布局，固定图片的适应宽度为 400px
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<Probe onRender={(value) => { zoom = value; }} />); });
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('useImageZoom', () => {
    it('初始为 100%，使用适应样式', () => {
        expect(zoom.zoom).toBe(1);
        expect(zoom.imageStyle).toEqual(FIT);
    });

    it('放大按钮按 1.25 倍放大并按适应宽度换算图片宽度，缩小不低于 100%', async () => {
        await act(async () => zoom.zoomIn());
        expect(zoom.zoom).toBe(1.25);
        expect(zoom.imageStyle).toMatchObject({ width: 500, maxWidth: 'none', maxHeight: 'none' });

        await act(async () => zoom.zoomOut());
        await act(async () => zoom.zoomOut());
        expect(zoom.zoom).toBe(1);
        expect(zoom.imageStyle).toEqual(FIT);
    });

    it('最多放大到 500%', async () => {
        for (let i = 0; i < 20; i++) await act(async () => zoom.zoomIn());
        expect(zoom.zoom).toBe(MAX_ZOOM);
    });

    it('滚轮向上放大、向下缩小，并阻止页面滚动', async () => {
        const up = new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true });
        await dispatch(up);
        expect(up.defaultPrevented).toBe(true);
        expect(zoom.zoom).toBeGreaterThan(1);

        const before = zoom.zoom;
        await dispatch(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
        expect(zoom.zoom).toBeLessThan(before);
    });

    it('双指张开放大，捏合期间拦截指针移动并阻止浏览器缩放', async () => {
        await dispatch(touchEvent('touchstart', [[100, 100], [200, 100]]));

        const pointerMove = new Event('pointermove', { bubbles: true });
        const childListener = vi.fn();
        host.querySelector('img')!.addEventListener('pointermove', childListener);
        await act(async () => { host.querySelector('img')!.dispatchEvent(pointerMove); });
        expect(childListener).not.toHaveBeenCalled();

        const move = touchEvent('touchmove', [[50, 100], [250, 100]]);
        await dispatch(move);
        expect(move.defaultPrevented).toBe(true);
        expect(zoom.zoom).toBeCloseTo(2);

        await dispatch(touchEvent('touchend', [[50, 100]]));
        await act(async () => { host.querySelector('img')!.dispatchEvent(new Event('pointermove', { bubbles: true })); });
        expect(childListener).toHaveBeenCalledTimes(1);
    });

    it('还原回到 100%', async () => {
        await act(async () => zoom.zoomIn());
        await act(async () => zoom.reset());
        expect(zoom.zoom).toBe(1);
        expect(zoom.imageStyle).toEqual(FIT);
    });
});
