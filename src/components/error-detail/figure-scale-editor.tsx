"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { QuestionFigure } from "@/components/question-figure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";
import { DEFAULT_FIGURE_SCALE, isValidFigureScale, MAX_FIGURE_SCALE, MIN_FIGURE_SCALE, normalizeFigureScale } from "@/lib/figure-scale";
import { frontendLogger } from "@/lib/frontend-logger";

interface FigureScaleEditorProps {
    svg: string | null | undefined;
    scale?: number;
    onSave: (scale: number) => Promise<void>;
}

/** 预览当前题目的配图比例，保存后用于详情显示和文字打印。 */
export function FigureScaleEditor({ svg, scale, onSave }: FigureScaleEditorProps) {
    const { t } = useLanguage();
    const inputId = useId();
    const savedScale = normalizeFigureScale(scale);
    const [draft, setDraft] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const value = draft ?? String(savedScale);
    const valid = value.trim() !== '' && isValidFigureScale(Number(value));
    const previewScale = valid ? Number(value) : savedScale;
    const changed = draft !== null && (!valid || Number(value) !== savedScale);

    if (!svg) return null;

    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!valid || !changed || saving) return;
        setSaving(true);
        try {
            await onSave(previewScale);
            setDraft(null);
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
            <QuestionFigure svg={svg} scale={previewScale} />
            <form onSubmit={save} className="space-y-2 rounded-md border p-3 print:hidden">
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
                    <Button type="submit" size="sm" disabled={saving || !changed || !valid}>
                        {saving ? t.common.progress.saving : t.common.save}
                    </Button>
                    {changed && (
                        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setDraft(null)}>
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
