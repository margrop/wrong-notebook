import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SvgAnimationPlayer } from '@/components/svg-animation-player';
import { LanguageProvider } from '@/contexts/LanguageContext';

const narration = vi.hoisted(() => ({ stop: vi.fn(), update: vi.fn(), prime: vi.fn() }));
vi.mock('@/lib/hooks/use-svg-narration', () => ({
    useSvgNarration: () => ({ ...narration, enabled: true, holding: false, speaking: false }),
}));

let container: HTMLDivElement;
let root: Root;
const svg = '<svg viewBox="0 0 800 500"><animate attributeName="x" dur="10s"/></svg>';

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

async function render(source = svg) {
    await act(async () => root.render(<LanguageProvider><SvgAnimationPlayer svg={source} /></LanguageProvider>));
}

async function load() {
    const iframe = container.querySelector('iframe')!;
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const timeline = { pauseAnimations: vi.fn(), unpauseAnimations: vi.fn(), setCurrentTime: vi.fn(), getCurrentTime: () => 0 };
    Object.assign(element, timeline);
    const cssAnimation = { pause: vi.fn(), play: vi.fn(), currentTime: 200 };
    vi.spyOn(iframe.contentDocument!, 'querySelector').mockReturnValue(element);
    Object.assign(iframe.contentDocument!, { getAnimations: () => [cssAnimation] });
    await act(async () => iframe.dispatchEvent(new Event('load')));
    return { iframe, timeline, cssAnimation };
}

function button(label: string) {
    return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}

describe('SVG 动画必须手工播放', () => {
    it('加载后 SMIL 和 CSS 停在首帧，画面与朗读均不自动开始', async () => {
        await render();
        expect(button('播放').disabled).toBe(true);
        const { iframe, timeline, cssAnimation } = await load();

        expect(timeline.pauseAnimations).toHaveBeenCalled();
        expect(timeline.setCurrentTime).toHaveBeenCalledWith(0);
        expect(cssAnimation.pause).toHaveBeenCalled();
        expect(cssAnimation.currentTime).toBe(0);
        expect(timeline.unpauseAnimations).not.toHaveBeenCalled();
        expect(cssAnimation.play).not.toHaveBeenCalled();
        expect(narration.prime).not.toHaveBeenCalled();
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        expect(button('播放').disabled).toBe(false);
        expect(iframe.style.visibility).toBe('visible');
    });

    it('点击播放才恢复两条时间轴和朗读，点击暂停后停止', async () => {
        await render();
        const { timeline, cssAnimation } = await load();
        await act(async () => button('播放').click());
        expect(timeline.unpauseAnimations).toHaveBeenCalledOnce();
        expect(cssAnimation.play).toHaveBeenCalledOnce();
        expect(narration.prime).toHaveBeenCalledOnce();
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        await act(async () => button('暂停').click());
        expect(timeline.pauseAnimations).toHaveBeenCalledTimes(2);
        expect(cssAnimation.pause).toHaveBeenCalledTimes(2);
        expect(button('播放')).toBeTruthy();
    });

    it('切换或重新生成动画后重新停在首帧', async () => {
        await render();
        await load();
        await act(async () => button('播放').click());
        await render(svg.replace('10s', '12s'));
        expect(container.querySelector('iframe')!.style.visibility).toBe('hidden');
        const { timeline, cssAnimation } = await load();
        expect(timeline.setCurrentTime).toHaveBeenCalledWith(0);
        expect(timeline.unpauseAnimations).not.toHaveBeenCalled();
        expect(cssAnimation.play).not.toHaveBeenCalled();
        expect(button('播放')).toBeTruthy();
    });

    it('手工点击重播会从头开始播放', async () => {
        await render();
        const { timeline, cssAnimation } = await load();
        await act(async () => button('重播').click());
        expect(timeline.setCurrentTime).toHaveBeenLastCalledWith(0);
        expect(timeline.unpauseAnimations).toHaveBeenCalledOnce();
        expect(cssAnimation.play).toHaveBeenCalledOnce();
    });
});
