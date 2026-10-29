"use client";

import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

interface NarrationControlsProps {
    supported: boolean;
    enabled: boolean;
    rate: number;
    /** 全屏时控制栏为深色背景 */
    fullscreen: boolean;
    onToggle: () => void;
    onCycleRate: () => void;
}

/**
 * 动画播放器控制栏中的语音讲解开关和语速；浏览器没有可用语音时开关禁用并提示原因
 */
export function NarrationControls({ supported, enabled, rate, fullscreen, onToggle, onCycleRate }: NarrationControlsProps) {
    const { t } = useLanguage();
    const ghost = cn("h-8 shrink-0", fullscreen && "text-white hover:bg-white/20 hover:text-white");
    const label = !supported ? t.svgAnimation.voiceUnsupported : enabled ? t.svgAnimation.voiceOff : t.svgAnimation.voiceOn;

    return (
        <>
            {/* 禁用的按钮不触发悬停提示，外层 span 承载 title */}
            <span title={label} className="shrink-0">
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(ghost, "w-8 p-0", enabled && supported && !fullscreen && "text-primary")}
                    onClick={onToggle}
                    disabled={!supported}
                    aria-label={label}
                    aria-pressed={enabled && supported}
                >
                    {enabled && supported ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </Button>
            </span>
            {enabled && supported && (
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(ghost, "px-1.5 text-xs tabular-nums")}
                    onClick={onCycleRate}
                    aria-label={t.svgAnimation.voiceRate}
                    title={t.svgAnimation.voiceRate}
                >
                    {rate}×
                </Button>
            )}
        </>
    );
}
