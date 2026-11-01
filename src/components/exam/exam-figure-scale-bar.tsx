"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";
import {
    DEFAULT_FIGURE_ALIGN,
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

interface ExamFigureScaleBarProps {
    scales: (number | undefined)[];
    aligns?: (FigureAlign | string | null | undefined)[];
    onPreviewChange?: (preview: { scale: number | null; align: FigureAlign | null }) => void;
    onSave: (patch: { figureScale?: number; figureAlign?: FigureAlign }) => Promise<void>;
}

/** 统一调整整份试卷所有配图题目的显示与打印比例及显示位置。 */
export function ExamFigureScaleBar({ scales, aligns, onPreviewChange, onSave }: ExamFigureScaleBarProps) {
    const { t } = useLanguage();
    const inputId = useId();
    const normalizedScales = scales.map(normalizeFigureScale);
    const isScaleUniform = new Set(normalizedScales).size <= 1;
    const savedScale = normalizedScales[0] ?? DEFAULT_FIGURE_SCALE;

    const normalizedAligns = (aligns ?? scales.map(() => DEFAULT_FIGURE_ALIGN)).map(normalizeFigureAlign);
    const isAlignUniform = new Set(normalizedAligns).size <= 1;
    const savedAlign = normalizedAligns[0] ?? DEFAULT_FIGURE_ALIGN;

    const [draftScale, setDraftScale] = useState<string | null>(null);
    const [draftAlign, setDraftAlign] = useState<FigureAlign | null>(null);
    const [saving, setSaving] = useState(false);

    if (scales.length === 0) return null;

    const value = draftScale ?? String(savedScale);
    const valid = value.trim() !== "" && isValidFigureScale(Number(value));
    const previewScale = valid ? Number(value) : savedScale;
    const previewAlign = draftAlign ?? savedAlign;
    const hasDraft = draftScale !== null || draftAlign !== null;
    const scaleChanged = draftScale !== null ? (!valid || !isScaleUniform || Number(value) !== savedScale) : (!hasDraft && !isScaleUniform);
    const alignChanged = draftAlign !== null ? (!isAlignUniform || draftAlign !== savedAlign) : (!hasDraft && !isAlignUniform);
    const changed = scaleChanged || alignChanged;

    const notifyPreview = (nextScaleDraft: string | null, nextAlignDraft: FigureAlign | null) => {
        const nextScale = nextScaleDraft !== null && nextScaleDraft.trim() !== "" && isValidFigureScale(Number(nextScaleDraft))
            ? Number(nextScaleDraft)
            : null;
        onPreviewChange?.({ scale: nextScale, align: nextAlignDraft });
    };

    const updateDraftScale = (next: string | null) => {
        setDraftScale(next);
        notifyPreview(next, draftAlign);
    };

    const updateDraftAlign = (next: FigureAlign | null) => {
        setDraftAlign(next);
        notifyPreview(draftScale, next);
    };

    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!valid || !changed || saving) return;
        setSaving(true);
        try {
            const patch: { figureScale?: number; figureAlign?: FigureAlign } = {};
            if (draftScale !== null || (!hasDraft && !isScaleUniform)) {
                patch.figureScale = previewScale;
            }
            if (draftAlign !== null || (!hasDraft && !isAlignUniform)) {
                patch.figureAlign = previewAlign;
            }
            await onSave(patch);
            setDraftScale(null);
            setDraftAlign(null);
            onPreviewChange?.({ scale: null, align: null });
            toast.success(t.common.messages.saveSuccess);
        } catch (error) {
            frontendLogger.error("[ExamFigureScale]", "统一保存试卷配图设置失败", { error });
            toast.error(t.common.messages.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={save} className="figure-scale-editor-controls w-full space-y-2 rounded-md border bg-background p-3 print:hidden">
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <label htmlFor={inputId} className="font-medium">{t.exam.uniformFigureScale}</label>
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
                    onChange={(event) => updateDraftScale(event.target.value)}
                    className="h-8 w-20"
                />
                <span>%</span>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving || (isScaleUniform && valid && previewScale === DEFAULT_FIGURE_SCALE)}
                    onClick={() => updateDraftScale(String(DEFAULT_FIGURE_SCALE))}
                >
                    {t.figure.resetScale}
                </Button>
                <div role="group" aria-label={t.exam.uniformFigureAlign} className="inline-flex items-center gap-1">
                    <span className="text-muted-foreground">{t.exam.uniformFigureAlign}</span>
                    {FIGURE_ALIGNS.map((option) => (
                        <Button
                            key={option}
                            type="button"
                            variant={previewAlign === option && (draftAlign !== null || isAlignUniform) ? "default" : "outline"}
                            size="sm"
                            disabled={saving}
                            aria-pressed={previewAlign === option && (draftAlign !== null || isAlignUniform)}
                            onClick={() => updateDraftAlign(isAlignUniform && option === savedAlign ? null : option)}
                        >
                            {t.figure.aligns[option]}
                        </Button>
                    ))}
                </div>
                <Button type="submit" size="sm" disabled={saving || !changed || !valid}>
                    {saving ? t.common.progress.saving : t.common.save}
                </Button>
                {hasDraft && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        onClick={() => {
                            setDraftScale(null);
                            setDraftAlign(null);
                            onPreviewChange?.({ scale: null, align: null });
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
                aria-label={t.exam.uniformFigureScaleSlider}
                aria-describedby={`${inputId}-hint`}
                onChange={(event) => updateDraftScale(event.target.value)}
                className="block h-6 w-full max-w-sm accent-primary"
            />
            <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">{t.exam.uniformFigureScaleHint}</p>
        </form>
    );
}
