"use client";

import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

interface DraftStartBarProps {
    /** 已选且可以开始的题数 */
    count: number;
    /** 已选但还没有区域的图片题数 */
    missingRegions: number;
    /** 有待接受修正建议的题数（开始后这些题按原文解析） */
    pendingFixes?: number;
    confirmBeforeImport: boolean;
    /** 正在进行的阶段文字（裁剪、提交）；为空表示空闲 */
    starting: string | null;
    onStart: () => void;
    onDiscard: () => void;
    /** 批次来源：图片批次不支持「按原样入库」 */
    source: "text" | "image";
    /** 解析方式：ai 调用 AI 识别；none 按原样入库（不调用 AI、不计额度） */
    analysisMode: "ai" | "none";
    onAnalysisModeChange: (mode: "ai" | "none") => void;
    /** 是否已选目标错题本（按原样入库必须指定） */
    hasTargetNotebook: boolean;
}

/** 分题预览底部固定的操作栏：按钮写明实际动作与题数；文字批次可选「按原样入库」不调用 AI */
export function DraftStartBar({ count, missingRegions, pendingFixes = 0, confirmBeforeImport, starting, onStart, onDiscard, source, analysisMode, onAnalysisModeChange, hasTargetNotebook }: DraftStartBarProps) {
    const { t } = useLanguage();
    const noAnalysis = analysisMode === "none";
    const label = noAnalysis
        ? (confirmBeforeImport ? t.importBatch.startNoneReview : t.importBatch.startNoneAuto).replace("{count}", String(count))
        : (confirmBeforeImport ? t.importBatch.startReview : t.importBatch.startAuto).replace("{count}", String(count));
    const hint = count === 0
        ? t.importBatch.nothingSelected
        : missingRegions > 0
            ? t.importBatch.needsRegion.replace("{count}", String(missingRegions))
            : noAnalysis
                ? t.importBatch.startHintNone
                : pendingFixes > 0
                    ? t.importBatch.fixText.pendingHint.replace("{count}", String(pendingFixes))
                    : confirmBeforeImport ? t.importBatch.startHintReview : t.importBatch.startHintAuto;
    // 按原样入库需要目标错题本；图片批次不支持
    const noneDisabled = !hasTargetNotebook;
    const noneDisabledHint = !hasTargetNotebook ? t.importBatch.startNoneNoTarget : undefined;

    return (
        // 手机上停在底部导航栏之上，右侧留出「后台任务」悬浮按钮的位置；电脑上随内容吸底
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 py-3 pl-4 pr-16 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur md:sticky md:bottom-4 md:rounded-xl md:border md:px-4" data-testid="draft-start-bar">
            <div className="mx-auto flex max-w-4xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                    {source === "text" && (
                        <div className="flex flex-wrap items-center gap-2 text-xs" role="radiogroup" aria-label={t.importBatch.analysisModeLabel}>
                            <button
                                type="button"
                                role="radio"
                                aria-checked={!noAnalysis}
                                disabled={!!starting}
                                onClick={() => onAnalysisModeChange("ai")}
                                className={`rounded-full border px-2.5 py-1 transition-colors ${!noAnalysis ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
                                data-testid="draft-analysis-ai"
                            >
                                {t.importBatch.analysisAi}
                            </button>
                            <button
                                type="button"
                                role="radio"
                                aria-checked={noAnalysis}
                                disabled={!!starting || noneDisabled}
                                onClick={() => onAnalysisModeChange("none")}
                                title={noneDisabledHint}
                                className={`rounded-full border px-2.5 py-1 transition-colors ${noAnalysis ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"} disabled:cursor-not-allowed disabled:opacity-50`}
                                data-testid="draft-analysis-none"
                            >
                                {t.importBatch.analysisNone}
                            </button>
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground md:max-w-md" data-testid="draft-start-hint">{starting ?? hint}</p>
                </div>
                <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={onDiscard} disabled={!!starting} className="shrink-0">
                        {t.importBatch.discard}
                    </Button>
                    <Button type="button" onClick={onStart} disabled={count === 0 || !!starting} className="min-w-0 flex-1 md:flex-none" data-testid="draft-start">
                        {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        <span className="truncate">{label}</span>
                    </Button>
                </div>
            </div>
        </div>
    );
}
