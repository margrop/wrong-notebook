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
    /** 识别时裁剪的原配图（PNG data URI） */
    image?: string | null;
    /** 当前显示来源：svg | image */
    source?: string | null;
    align?: FigureAlign | string | null;
    /** 统一调整全卷配图比例时的临时预览值，未保存前优先预览该比例 */
    previewScaleOverride?: number | null;
    /** 统一调整全卷配图位置时的临时预览值，未保存前优先预览该位置 */
    previewAlignOverride?: FigureAlign | null;
    onSave: (scale: number, align: FigureAlign) => Promise<void>;
    /** 切换显示原图或 AI 重绘时保存；为空时不显示切换按钮 */
    onSaveSource?: (source: "svg" | "image") => Promise<void>;
}

/** 预览当前题目的配图比例与显示位置，保存后用于详情显示和文字打印。 */
export function FigureScaleEditor({
    svg,
    image,
    source,
    scale,
    align,
    previewScaleOverride,
    previewAlignOverride,
    onSave,
    onSaveSource,
}: FigureScaleEditorProps) {
    const { t } = useLanguage();
    const inputId = useId();
    const savedScale = normalizeFigureScale(scale);
    const savedAlign = normalizeFigureAlign(align);
    const [draft, setDraft] = useState<string | null>(null);
    const [draftAlign, setDraftAlign] = useState<FigureAlign | null>(null);
    const [saving, setSaving] = useState(false);
    const [draftSource, setDraftSource] = useState<"svg" | "image" | null>(null);
    const [savingSource, setSavingSource] = useState(false);
    const value = draft ?? String(savedScale);
    const valid = value.trim() !== '' && isValidFigureScale(Number(value));
    const previewScale = valid ? Number(value) : savedScale;
    const previewAlign = draftAlign ?? savedAlign;
    const effectiveScale = previewScaleOverride ?? previewScale;
    const effectiveAlign = previewAlignOverride ?? previewAlign;
    const effectiveSource = draftSource ?? (source === "image" || !svg ? "image" : "svg");
    const scaleChanged = draft !== null && (!valid || Number(value) !== savedScale);
    const alignChanged = draftAlign !== null && draftAlign !== savedAlign;
    const changed = scaleChanged || alignChanged;

    if (!svg && !image) return null;

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

    const saveSource = async (next: "svg" | "image") => {
        if (!onSaveSource || savingSource || next === effectiveSource) return;
        setSavingSource(true);
        try {
            await onSaveSource(next);
            setDraftSource(next);
            toast.success(t.common.messages.saveSuccess);
        } catch (error) {
            frontendLogger.error('[FigureScale]', '切换配图来源失败', { error });
            toast.error(t.common.messages.saveFailed);
        } finally {
            setSavingSource(false);
        }
    };

    return (
        <div>
            <QuestionFigure svg={svg} image={image} source={effectiveSource} scale={effectiveScale} align={effectiveAlign} />
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
                    {svg && image && onSaveSource && (
                        <div role="group" aria-label={t.figure.source} className="inline-flex items-center gap-1">
                            <span className="text-muted-foreground">{t.figure.source}</span>
                            <Button type="button" variant={effectiveSource === "svg" ? "default" : "outline"} size="sm" disabled={savingSource} aria-pressed={effectiveSource === "svg"} onClick={() => { void saveSource("svg"); }}>
                                {t.figure.sourceSvg}
                            </Button>
                            <Button type="button" variant={effectiveSource === "image" ? "default" : "outline"} size="sm" disabled={savingSource} aria-pressed={effectiveSource === "image"} onClick={() => { void saveSource("image"); }}>
                                {t.figure.sourceImage}
                            </Button>
                        </div>
                    )}
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
