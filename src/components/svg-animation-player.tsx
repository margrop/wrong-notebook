"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minimize, Pause, Play, RotateCcw } from "lucide-react";
import { NarrationControls } from "@/components/svg-animation/narration-controls";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { buildSvgAnimationDocument, extractSubtitleNarration, getEmbeddedNarration, getSvgAnimationDuration, getSvgAspectRatio } from "@/lib/svg-animation";
import type { NarrationSegment } from "@/lib/svg-animation";
import { useSvgNarration } from "@/lib/use-svg-narration";
import { cn } from "@/lib/utils";

interface SvgAnimationPlayerProps {
    svg: string;
    /** 所属错题，合成云端语音时用于后台任务的说明和跳转 */
    errorItemId?: string;
}

function formatTime(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * SVG 动画播放器：支持播放/暂停、拖动进度条、重播、全屏和语音讲解。
 * 全屏优先用浏览器的 Fullscreen API；不支持时（如 iPhone Safari）改为铺满窗口的浮层。
 * SVG 放在不允许脚本的 sandbox iframe 中（仅 allow-same-origin，便于本页调用 SMIL 时间轴接口），
 * 其中的脚本和事件属性都不会执行。
 * 语音讲解优先朗读动画内保存的讲解稿，旧动画没有讲解稿时朗读字幕区的文字。
 */
export function SvgAnimationPlayer({ svg, errorItemId }: SvgAnimationPlayerProps) {
    const { t, language } = useLanguage();
    const containerRef = useRef<HTMLDivElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [playing, setPlaying] = useState(false);
    const [current, setCurrent] = useState(0);
    const [nativeFullscreen, setNativeFullscreen] = useState(false);
    const [overlayFullscreen, setOverlayFullscreen] = useState(false);
    const fullscreen = nativeFullscreen || overlayFullscreen;

    const duration = useMemo(() => getSvgAnimationDuration(svg), [svg]);
    const aspectRatio = useMemo(() => getSvgAspectRatio(svg), [svg]);
    const srcDoc = useMemo(() => buildSvgAnimationDocument(svg), [svg]);
    const embeddedNarration = useMemo(() => getEmbeddedNarration(svg), [svg]);
    const [subtitleNarration, setSubtitleNarration] = useState<NarrationSegment[] | null>(null);
    const narrationSegments = embeddedNarration ?? subtitleNarration;

    /** CSS 动画（若有）跟随 SMIL 时间轴 */
    const cssAnimations = useCallback(() => {
        const doc = iframeRef.current?.contentDocument;
        return typeof doc?.getAnimations === "function" ? doc.getAnimations() : [];
    }, []);

    /** 只暂停或恢复画面，不改变播放状态（等待语音读完时使用） */
    const holdAnimation = useCallback((hold: boolean) => {
        if (hold) svgRef.current?.pauseAnimations();
        else svgRef.current?.unpauseAnimations();
        cssAnimations().forEach((animation) => (hold ? animation.pause() : animation.play()));
    }, [cssAnimations]);

    const narration = useSvgNarration({ segments: narrationSegments, language, errorItemId, holdAnimation });
    // 画面在等朗读（等待中或动画已播完、语音还在读）时，只在外框提示，不遮挡内容
    const waitingForVoice = narration.enabled && (narration.holding || (!playing && narration.speaking));
    const { stop: stopNarration, update: updateNarration, prime: primeNarration } = narration;

    /** 暂停画面；播完自动暂停时不打断最后一段朗读 */
    const pauseAnimation = useCallback(() => {
        svgRef.current?.pauseAnimations();
        cssAnimations().forEach((animation) => animation.pause());
        setPlaying(false);
    }, [cssAnimations]);

    const pause = useCallback(() => {
        // 先停止朗读（会恢复等待中的画面），再暂停画面
        stopNarration(svgRef.current?.getCurrentTime() ?? 0);
        pauseAnimation();
    }, [pauseAnimation, stopNarration]);

    const seek = useCallback((time: number) => {
        svgRef.current?.setCurrentTime(time);
        cssAnimations().forEach((animation) => { animation.currentTime = time * 1000; });
        setCurrent(time);
        stopNarration(time);
    }, [cssAnimations, stopNarration]);

    const play = useCallback(() => {
        const element = svgRef.current;
        if (!element) return;
        // 已播完时从头开始
        if (duration > 0 && element.getCurrentTime() >= duration) seek(0);
        element.unpauseAnimations();
        cssAnimations().forEach((animation) => animation.play());
        setPlaying(true);
        // 播放和重播由点击触发，借此解锁 iOS 上的朗读
        primeNarration();
    }, [cssAnimations, duration, seek, primeNarration]);

    const handleLoad = () => {
        svgRef.current = iframeRef.current?.contentDocument?.querySelector("svg") ?? null;
        setSubtitleNarration(svgRef.current ? extractSubtitleNarration(svgRef.current) : null);
        stopNarration(0);
        setCurrent(0);
        setPlaying(!!svgRef.current);
    };

    const toggleFullscreen = async () => {
        if (overlayFullscreen) {
            setOverlayFullscreen(false);
            return;
        }
        if (document.fullscreenElement) {
            await document.exitFullscreen().catch(() => undefined);
            return;
        }
        const container = containerRef.current;
        if (container && typeof container.requestFullscreen === "function") {
            try {
                await container.requestFullscreen();
                return;
            } catch {
                // 浏览器拒绝时退回浮层
            }
        }
        setOverlayFullscreen(true);
    };

    // 跟随浏览器全屏状态（包括按 Esc 退出）
    useEffect(() => {
        const handleChange = () => setNativeFullscreen(document.fullscreenElement === containerRef.current);
        document.addEventListener("fullscreenchange", handleChange);
        return () => document.removeEventListener("fullscreenchange", handleChange);
    }, []);

    // 浮层全屏：按 Esc 退出，并禁止背后页面滚动
    useEffect(() => {
        if (!overlayFullscreen) return;
        const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOverlayFullscreen(false); };
        const overflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        document.addEventListener("keydown", handleKey);
        return () => {
            document.body.style.overflow = overflow;
            document.removeEventListener("keydown", handleKey);
        };
    }, [overlayFullscreen]);

    // 播放时跟踪进度，到结尾自动暂停在最后一帧
    useEffect(() => {
        if (!playing) return;
        let frame = 0;
        const tick = () => {
            const time = svgRef.current?.getCurrentTime() ?? 0;
            updateNarration(time);
            if (duration > 0 && time >= duration) {
                svgRef.current?.setCurrentTime(duration);
                pauseAnimation();
                setCurrent(duration);
                return;
            }
            setCurrent(time);
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, duration, pauseAnimation, updateNarration]);

    return (
        <div
            ref={containerRef}
            className={cn(
                "space-y-2",
                fullscreen && "flex flex-col items-center justify-center bg-black p-4",
                overlayFullscreen && "fixed inset-0 z-50"
            )}
        >
            <iframe
                ref={iframeRef}
                srcDoc={srcDoc}
                sandbox="allow-same-origin"
                title={t.svgAnimation.alt}
                onLoad={handleLoad}
                className={cn(
                    "mx-auto block rounded border bg-white transition-shadow",
                    !fullscreen && "w-full max-w-3xl",
                    waitingForVoice && "border-primary ring-2 ring-primary/40"
                )}
                // 全屏时按宽高比放到最大，留出控制栏的高度
                style={fullscreen
                    ? { aspectRatio, width: `min(100%, calc((100dvh - 96px) * ${aspectRatio}))` }
                    : { aspectRatio }}
            />
            <div className={cn("mx-auto flex w-full items-center gap-2", fullscreen ? "max-w-5xl text-white" : "max-w-3xl")}>
                <Button
                    variant="outline"
                    size="sm"
                    // 全屏时控制栏文字为白色，播放按钮是白底，图标需保持深色
                    className="h-8 w-8 shrink-0 p-0 text-foreground"
                    onClick={playing ? pause : play}
                    aria-label={playing ? t.svgAnimation.pause : t.svgAnimation.play}
                    title={playing ? t.svgAnimation.pause : t.svgAnimation.play}
                >
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn("h-8 w-8 shrink-0 p-0", fullscreen && "text-white hover:bg-white/20 hover:text-white")}
                    onClick={() => { seek(0); play(); }}
                    aria-label={t.svgAnimation.replay}
                    title={t.svgAnimation.replay}
                >
                    <RotateCcw className="h-4 w-4" />
                </Button>
                {duration > 0 && (
                    <>
                        <input
                            type="range"
                            min={0}
                            max={duration}
                            step={0.1}
                            value={Math.min(current, duration)}
                            onChange={(e) => seek(Number(e.target.value))}
                            aria-label={t.svgAnimation.progress}
                            className="h-2 min-w-0 flex-1 cursor-pointer accent-primary"
                        />
                        <span className={cn("shrink-0 text-xs tabular-nums", fullscreen ? "text-white/80" : "text-muted-foreground")}>
                            {formatTime(current)} / {formatTime(duration)}
                        </span>
                    </>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                    {!!narrationSegments?.length && (
                        <NarrationControls
                            supported={narration.supported}
                            enabled={narration.enabled}
                            rate={narration.rate}
                            fullscreen={fullscreen}
                            onToggle={() => narration.setEnabled(!narration.enabled, svgRef.current?.getCurrentTime() ?? 0)}
                            onCycleRate={narration.cycleRate}
                        />
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        className={cn("h-8 w-8 shrink-0 p-0", fullscreen && "text-white hover:bg-white/20 hover:text-white")}
                        onClick={toggleFullscreen}
                        aria-label={fullscreen ? t.svgAnimation.exitFullscreen : t.svgAnimation.fullscreen}
                        title={fullscreen ? t.svgAnimation.exitFullscreen : t.svgAnimation.fullscreen}
                    >
                        {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                    </Button>
                </div>
            </div>
        </div>
    );
}
