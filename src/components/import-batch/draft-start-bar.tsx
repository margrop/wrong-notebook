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
}

/** 分题预览底部固定的操作栏：按钮写明实际动作与题数 */
export function DraftStartBar({ count, missingRegions, pendingFixes = 0, confirmBeforeImport, starting, onStart, onDiscard }: DraftStartBarProps) {
    const { t } = useLanguage();
    const label = (confirmBeforeImport ? t.importBatch.startReview : t.importBatch.startAuto).replace("{count}", String(count));
    const hint = count === 0
        ? t.importBatch.nothingSelected
        : missingRegions > 0
            ? t.importBatch.needsRegion.replace("{count}", String(missingRegions))
            : pendingFixes > 0
                ? t.importBatch.fixText.pendingHint.replace("{count}", String(pendingFixes))
                : confirmBeforeImport ? t.importBatch.startHintReview : t.importBatch.startHintAuto;

    return (
        // 手机上停在底部导航栏之上，右侧留出「后台任务」悬浮按钮的位置；电脑上随内容吸底
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 py-3 pl-4 pr-16 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur md:sticky md:bottom-4 md:rounded-xl md:border md:px-4" data-testid="draft-start-bar">
            <div className="mx-auto flex max-w-4xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <p className="text-xs text-muted-foreground md:max-w-md" data-testid="draft-start-hint">{starting ?? hint}</p>
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
