"use client";

import { Layers, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

interface QuestionPartsBarProps {
    /** 已暂存各段的图片（data URL），按顺序 */
    parts: string[];
    busy: boolean;
    onFinish: () => void;
    onDiscard: () => void;
}

/** 一道题分在几张纸上时：显示已暂存的各段，可以继续选下一张，或直接拼成一题识别 */
export function QuestionPartsBar({ parts, busy, onFinish, onDiscard }: QuestionPartsBarProps) {
    const { t } = useLanguage();
    return (
        <section className="space-y-3 rounded-2xl border border-primary/40 bg-primary/5 p-4" data-testid="question-parts">
            <div className="flex items-center gap-2 text-sm font-semibold">
                <Layers className="h-4 w-4 text-primary" />
                {t.upload.parts.title.replace("{count}", String(parts.length))}
            </div>
            <ol className="flex gap-2 overflow-x-auto pb-1">
                {parts.map((url, index) => (
                    <li key={index} className="shrink-0 text-center text-xs text-muted-foreground">
                        <img src={url} alt={t.upload.parts.part.replace("{n}", String(index + 1))} className="h-20 max-w-[8rem] rounded border bg-white object-contain" />
                        {t.upload.parts.part.replace("{n}", String(index + 1))}
                    </li>
                ))}
            </ol>
            <p className="text-xs text-muted-foreground">{t.upload.parts.hint}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={onFinish} disabled={busy} className="sm:flex-1">
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Layers className="mr-2 h-4 w-4" />}
                    {t.upload.parts.finish.replace("{count}", String(parts.length))}
                </Button>
                <Button variant="ghost" onClick={onDiscard} disabled={busy}>
                    <X className="mr-1 h-4 w-4" />{t.upload.parts.discard}
                </Button>
            </div>
        </section>
    );
}
