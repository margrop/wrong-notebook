"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { QuestionFigure } from "@/components/question-figure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";
import {
    DEFAULT_FIGURE_SCALE,
    FIGURE_ALIGNS,
    isValidFigureScale,
    MAX_FIGURE_SCALE,
    MIN_FIGURE_SCALE,
    normalizeFigureAlign,
    normalizeFigureScale,
} from "@/lib/figure-scale";
import type { FigureAlign } from "@/lib/figure-scale";
import { frontendLogger } from "@/lib/frontend-logger";

interface FigureScaleEditorProps {
    svg: string | null | undefined;
    scale?: number;
    align?: FigureAlign | string | null;
    /** 统一调整全卷配图比例时的临时预览值，未保存前优先预览该比例 */
    previewScaleOverride?: number | null;
    /** 统一调整全卷配图位置时的临时预览值，未保存前优先预览该位置 */
    previewAlignOverride?: FigureAlign | null;
    onSave: (scale: number, align: FigureAlign) => Promise<void>;
}

/** 预览当前题目的配图比例与显示位置，保存后用于详情显示和文字打印。 */
export function FigureScaleEditor({
    svg,
    scale,
    align,
    previewScaleOverride,
    previewAlignOverride,
    onSave,
}: FigureScaleEditorProps) {
    const { t } = useLanguage();
    const inputId = useId();
    const savedScale = normalizeFigureScale(scale);
    const savedAlign = normalizeFigureAlign(align);
    const [draft, setDraft] = useState<string | null>(null);
    const [draftAlign, setDraftAlign] = useState<FigureAlign | null>(null);
    const [saving, setSaving] = useState(false);
    const value = draft ?? String(savedScale);
    const valid = value.trim() !== '' && isValidFigureScale(Number(value));
    const previewScale = valid ? Number(value) : savedScale;
    const previewAlign = draftAlign ?? savedAlign;
    const effectiveScale = previewScaleOverride ?? previewScale;
    const effectiveAlign = previewAlignOverride ?? previewAlign;
    const scaleChanged = draft !== null && (!valid || Number(value) !== savedScale);
    const alignChanged = draftAlign !== null && draftAlign !== savedAlign;
    const changed = scaleChanged || alignChanged;

    if (!svg) return null;

    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!valid || !changed || saving) return;
        setSaving(true);
        try {
            await onSave(previewScale, previewAlign);
            setDraft(null);
            setDraftAlign(null);
            toast.success(t.common.messages.saveSuccess);
        } catch (error) {
            frontendLogger.error('[FigureScale]', '保存配图比例失败', { error });
            toast.error(t.common.messages.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <QuestionFigure svg={svg} scale={effectiveScale} align={effectiveAlign} />
            <form onSubmit={save} className="figure-scale-editor-controls space-y-2 rounded-md border p-3 print:hidden">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                    <label htmlFor={inputId}>{t.figure.scale}</label>
                    <Input
                        id={inputId}
                        type="number"
                        min={MIN_FIGURE_SCALE}
                        max={MAX_FIGURE_SCALE}
                        step={1}
                        value={value}
                        disabled={saving}
                        aria-describedby={`${inputId}-hint`}
                        aria-invalid={!valid}
                        onChange={(event) => setDraft(event.target.value)}
                        className="h-8 w-20"
                    />
                    <span>%</span>
                    <Button type="button" variant="outline" size="sm" disabled={saving || (valid && previewScale === DEFAULT_FIGURE_SCALE)} onClick={() => setDraft(String(DEFAULT_FIGURE_SCALE))}>
                        {t.figure.resetScale}
                    </Button>
                    <div role="group" aria-label={t.figure.align} className="inline-flex items-center gap-1">
                        <span className="text-muted-foreground">{t.figure.align}</span>
                        {FIGURE_ALIGNS.map((option) => (
                            <Button
                                key={option}
                                type="button"
                                variant={previewAlign === option ? "default" : "outline"}
                                size="sm"
                                disabled={saving}
                                aria-pressed={previewAlign === option}
                                onClick={() => setDraftAlign(option === savedAlign ? null : option)}
                            >
                                {t.figure.aligns[option]}
                            </Button>
                        ))}
                    </div>
                    <Button type="submit" size="sm" disabled={saving || !changed || !valid}>
                        {saving ? t.common.progress.saving : t.common.save}
                    </Button>
                    {changed && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={saving}
                            onClick={() => {
                                setDraft(null);
                                setDraftAlign(null);
                            }}
                        >
                            {t.common.cancel}
                        </Button>
                    )}
                </div>
                <input
                    type="range"
                    min={MIN_FIGURE_SCALE}
                    max={MAX_FIGURE_SCALE}
                    step={1}
                    value={previewScale}
                    disabled={saving}
                    aria-label={t.figure.scaleSlider}
                    aria-describedby={`${inputId}-hint`}
                    onChange={(event) => setDraft(event.target.value)}
                    className="block h-6 w-full max-w-sm accent-primary"
                />
                <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">{t.figure.scaleHint}</p>
            </form>
        </div>
    );
}
