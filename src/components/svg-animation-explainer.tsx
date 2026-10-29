"use client";

import { useMemo, useState } from "react";
import { AudioLines, Clapperboard, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SvgAnimationPlayer } from "@/components/svg-animation-player";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { isNetworkError, waitForBackgroundTask } from "@/lib/background-task-recovery";
import type { BackgroundTaskKind } from "@/lib/background-tasks";
import { getApiErrorMessage, getErrorMessage } from "@/lib/error-message";
import { frontendLogger } from "@/lib/frontend-logger";
import { toast, confirmDialog } from "@/lib/feedback";
import { getEmbeddedNarration } from "@/lib/svg-animation";
import type { Language } from "@/lib/translations";

/** 动画 SVG 较长，AI 通常需要几分钟才能写完，前端等待上限与服务端 AI 请求超时一致 */
const GENERATE_TIMEOUT_MS = 10 * 60 * 1000;
/** 只补写讲解稿，输出较短 */
const NARRATION_TIMEOUT_MS = 5 * 60 * 1000;

interface SvgAnimationExplainerProps {
    errorItemId: string;
    /** 当前界面语言对应的动画 */
    svgAnimation: string | null | undefined;
    /** 另一语言是否已有动画（当前语言未生成时提示切换语言查看） */
    hasOtherLanguage?: boolean;
    /** 生成或删除后回调该语言的新动画（删除后为 null） */
    onChange: (language: Language, svgAnimation: string | null) => void;
}

/**
 * 题目的 SVG 动画讲解，按界面语言分别生成和显示：中文界面用中文版动画，英文界面用英文版动画。
 * 未生成时显示生成入口；已生成时可播放/暂停、拖动进度、重新生成和删除（删除需二次确认，只删除当前语言的动画）。
 * 已有动画可单独补写或重写语音讲解稿，画面不变。
 */
export function SvgAnimationExplainer({ errorItemId, svgAnimation, hasOtherLanguage, onChange }: SvgAnimationExplainerProps) {
    const { t, language } = useLanguage();
    const [generating, setGenerating] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [narrating, setNarrating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hasNarration = useMemo(() => !!svgAnimation && !!getEmbeddedNarration(svgAnimation), [svgAnimation]);

    const errorText = (code: string, fallback: string) => {
        const mapped = (t.errors as Record<string, unknown>)[code];
        return typeof mapped === "string" ? mapped : fallback;
    };

    /**
     * 发起生成请求并返回新的动画；请求在服务端返回前被浏览器中断时（iPhone 上的 Safari 常见），
     * 改为等待后台任务结束，再从题目中取回该语言的动画
     */
    const requestAnimation = async (path: string, kind: BackgroundTaskKind, timeout: number): Promise<string> => {
        const since = Date.now();
        try {
            const result = await apiClient.post<{ svgAnimation: string }>(path, { language }, { timeout });
            return result.svgAnimation;
        } catch (err) {
            if (!isNetworkError(err)) throw err;
            frontendLogger.warn('[SvgAnimation]', 'Request interrupted, waiting for background task', { kind, error: getErrorMessage(err) });
            const outcome = await waitForBackgroundTask({ kind, link: `/error-items/${errorItemId}`, since, timeoutMs: timeout });
            if (!outcome) throw err;
            // 与接口返回错误时相同的结构，交给调用方映射提示文案
            if (outcome.status === "failed") throw Object.assign(new Error(outcome.error ?? ""), { data: { message: outcome.error ?? "" } });
            const item = await apiClient.get<{ svgAnimation: string | null; svgAnimationEn: string | null }>(`/api/error-items/${errorItemId}`);
            const svg = language === "en" ? item.svgAnimationEn : item.svgAnimation;
            if (!svg) throw err;
            return svg;
        }
    };

    const handleGenerate = async () => {
        setGenerating(true);
        setError(null);
        try {
            onChange(language, await requestAnimation(`/api/error-items/${errorItemId}/svg-animation`, "svg_animation", GENERATE_TIMEOUT_MS));
        } catch (err) {
            const code = getApiErrorMessage(err) || "";
            frontendLogger.error('[SvgAnimation]', 'Failed to generate SVG animation', { code, error: getErrorMessage(err) });
            setError(
                code === "NO_QUESTION_TEXT" ? t.svgAnimation.noQuestionText
                    : code === "NO_VALID_ANIMATION" ? t.svgAnimation.invalid
                        : errorText(code, t.svgAnimation.failed)
            );
        } finally {
            setGenerating(false);
        }
    };

    const handleNarration = async () => {
        setNarrating(true);
        setError(null);
        try {
            onChange(language, await requestAnimation(`/api/error-items/${errorItemId}/svg-animation/narration`, "svg_narration", NARRATION_TIMEOUT_MS));
            toast.success(t.svgAnimation.narrationDone);
        } catch (err) {
            const code = getApiErrorMessage(err) || "";
            frontendLogger.error('[SvgAnimation]', 'Failed to generate SVG narration', { code, error: getErrorMessage(err) });
            setError(code === "NO_VALID_NARRATION" ? t.svgAnimation.narrationInvalid : errorText(code, t.svgAnimation.narrationFailed));
        } finally {
            setNarrating(false);
        }
    };

    const handleDelete = async () => {
        if (!(await confirmDialog(t.svgAnimation.confirmDelete, { destructive: true }))) return;
        setDeleting(true);
        try {
            await apiClient.delete(`/api/error-items/${errorItemId}/svg-animation?language=${language}`);
            onChange(language, null);
            setError(null);
        } catch (err) {
            frontendLogger.error('[SvgAnimation]', 'Failed to delete SVG animation', { error: err instanceof Error ? err.message : String(err) });
            toast.error(t.svgAnimation.deleteFailed);
        } finally {
            setDeleting(false);
        }
    };

    if (!svgAnimation) {
        return (
            <div className="rounded-lg border border-dashed p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clapperboard className="h-4 w-4" />
                        <span>{t.svgAnimation.title}</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
                        {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clapperboard className="mr-2 h-4 w-4" />}
                        {generating ? t.svgAnimation.generating : t.svgAnimation.generate}
                    </Button>
                </div>
                {error && <p className="text-xs text-destructive mt-2">{error}</p>}
                <p className="text-xs text-muted-foreground mt-2">{hasOtherLanguage ? t.svgAnimation.otherLanguageAvailable : t.svgAnimation.hint}</p>
            </div>
        );
    }

    const busy = generating || deleting || narrating;
    return (
        <div className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">{t.svgAnimation.title}</span>
                    {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={handleNarration}
                        disabled={busy}
                        title={t.svgAnimation.narrationHint}
                    >
                        {narrating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AudioLines className="h-3.5 w-3.5" />}
                        <span>{narrating ? t.svgAnimation.narrationGenerating : hasNarration ? t.svgAnimation.narrationRegenerate : t.svgAnimation.narrationGenerate}</span>
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={handleGenerate} disabled={busy}>
                        {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        <span>{generating ? t.svgAnimation.generating : t.svgAnimation.regenerate}</span>
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive" onClick={handleDelete} disabled={busy}>
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>{t.svgAnimation.delete}</span>
                    </Button>
                </div>
            </div>
            {error && <p className="px-3 pt-2 text-xs text-destructive">{error}</p>}
            <div className="p-2 sm:p-3">
                <SvgAnimationPlayer svg={svgAnimation} />
            </div>
        </div>
    );
}
