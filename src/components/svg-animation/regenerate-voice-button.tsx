"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { getSpeechMode, regenerateSpeech } from "@/lib/cloud-speech";
import { getApiErrorDetails, getApiErrorMessage, getErrorMessage } from "@/lib/error-message";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { extractSubtitleNarration, getEmbeddedNarration } from "@/lib/svg-animation";
import type { NarrationSegment } from "@/lib/svg-animation";

interface RegenerateVoiceButtonProps {
    svg: string;
    /** 所属错题，用于后台任务的说明和跳转 */
    errorItemId?: string;
    disabled: boolean;
    onBusyChange: (busy: boolean) => void;
}

/** 动画的讲解段落：讲解稿，没有时取画面底部的字幕（与播放器朗读的内容一致） */
function narrationOf(svg: string): NarrationSegment[] | null {
    const embedded = getEmbeddedNarration(svg);
    if (embedded) return embedded;
    try {
        const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
        return root.nodeName === "svg" ? extractSubtitleNarration(root) : null;
    } catch {
        return null;
    }
}

/**
 * 管理员选用云端语音时，已有动画可重新生成讲解语音：服务端忽略缓存重新合成全部段落（登记为后台任务，
 * 可在「后台任务」中查看进度），之后播放使用新语音
 */
export function RegenerateVoiceButton({ svg, errorItemId, disabled, onBusyChange }: RegenerateVoiceButtonProps) {
    const { t, language } = useLanguage();
    const [cloud, setCloud] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    const segments = useMemo(() => narrationOf(svg), [svg]);

    useEffect(() => {
        let active = true;
        getSpeechMode().then((mode) => {
            if (active) setCloud(mode === "cloud");
        });
        return () => {
            active = false;
        };
    }, []);

    if (!cloud || !segments?.length) return null;

    const handleClick = async () => {
        setRegenerating(true);
        onBusyChange(true);
        try {
            await regenerateSpeech(segments.map((segment) => segment.text), language, errorItemId);
            toast.success(t.svgAnimation.voiceRegenerateDone);
        } catch (err) {
            const code = getApiErrorMessage(err) || "";
            frontendLogger.error("[SvgAnimation]", "Failed to regenerate cloud voice", { code, error: getErrorMessage(err) });
            // 管理员会收到服务商的原始报错，附在提示后面
            const detail = getApiErrorDetails(err);
            const message = code === "TTS_DISABLED" ? t.svgAnimation.voiceRegenerateDisabled : t.svgAnimation.voiceRegenerateFailed;
            toast.error(detail ? `${message} (${detail})` : message);
        } finally {
            setRegenerating(false);
            onBusyChange(false);
        }
    };

    return (
        <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={handleClick}
            disabled={disabled || regenerating}
            title={t.svgAnimation.voiceRegenerateHint}
        >
            {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            <span>
                {regenerating ? t.svgAnimation.voiceRegenerating : t.svgAnimation.voiceRegenerate}
            </span>
        </Button>
    );
}
