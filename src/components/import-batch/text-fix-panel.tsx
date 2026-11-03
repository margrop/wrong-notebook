"use client";

import { useMemo } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { DraftTextFix } from "@/lib/question-split/draft";
import { diffText } from "@/lib/question-split/text-fix";

interface TextFixPanelProps {
    fix: DraftTextFix;
    onAccept: () => void;
    onReject: () => void;
}

/** 一题的 AI 修正建议：逐字标出删去和改动的内容，由用户接受或保留原文 */
export function TextFixPanel({ fix, onAccept, onReject }: TextFixPanelProps) {
    const { t } = useLanguage();
    const segments = useMemo(() => diffText(fix.original, fix.text), [fix.original, fix.text]);

    return (
        <div className="space-y-2 rounded-lg border border-violet-300 bg-violet-50/60 p-2 text-sm dark:border-violet-800 dark:bg-violet-950/30" data-testid="text-fix-panel">
            <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="flex items-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-300">
                    <Sparkles className="h-3 w-3" />{t.importBatch.fixText.title}
                </span>
                <span className="text-xs text-muted-foreground">{t.importBatch.fixText.legend}</span>
            </div>
            <p className="whitespace-pre-wrap break-words font-mono text-sm" data-testid="text-fix-diff">
                {segments.map((segment, index) => (
                    segment.type === "same" ? <span key={index}>{segment.text}</span>
                        : segment.type === "removed" ? <del key={index} className="bg-red-100 text-red-700 decoration-red-500 dark:bg-red-950/50 dark:text-red-300">{segment.text}</del>
                            : <ins key={index} className="bg-emerald-100 text-emerald-800 no-underline dark:bg-emerald-950/50 dark:text-emerald-300">{segment.text}</ins>
                ))}
            </p>
            {fix.uncertain.length > 0 && (
                <div className="text-xs text-amber-800 dark:text-amber-300">
                    <span>{t.importBatch.fixText.uncertain}</span>
                    <ul className="mt-0.5 list-inside list-disc">
                        {fix.uncertain.map((text, index) => <li key={index} className="break-words">{text}</li>)}
                    </ul>
                </div>
            )}
            <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={onAccept}>
                    <Check className="mr-1 h-4 w-4" />{t.importBatch.fixText.accept}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onReject}>
                    <X className="mr-1 h-4 w-4" />{t.importBatch.fixText.reject}
                </Button>
            </div>
        </div>
    );
}
