"use client";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { isAnswerSpaceMode } from "@/lib/exam-answer-space";
import type { AnswerSpaceMode } from "@/lib/exam-answer-space";

export interface PrintDisplayOptions {
    showQuestionText: boolean;
    showAnswers: boolean;
    showAnalysis: boolean;
    showTags: boolean;
    imageScale: number;
    answerSpace?: AnswerSpaceMode;
}

interface PrintOptionsProps {
    options: PrintDisplayOptions;
    onChange: (patch: Partial<PrintDisplayOptions>) => void;
    hasCustomSpaces?: boolean;
    onResetCustomSpaces?: () => void;
}

interface ToggleOptionProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
}

function ToggleOption({ checked, onChange, label }: ToggleOptionProps) {
    return (
        <label className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer whitespace-nowrap hover:text-primary transition-colors">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="rounded border-gray-300 text-primary focus:ring-primary w-3.5 h-3.5 sm:w-4 sm:h-4"
            />
            {label}
        </label>
    );
}

/** 打印预览顶部的图片缩放、留白档位和显示内容开关 */
export function PrintOptions({ options, onChange, hasCustomSpaces, onResetCustomSpaces }: PrintOptionsProps) {
    const { t } = useLanguage();
    const answerSpace = options.answerSpace ?? "auto";

    return (
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2 text-sm bg-muted/50 px-2 sm:px-3 py-1 rounded-md">
                <span className="whitespace-nowrap text-xs sm:text-sm">{t.printPreview?.imageScale || 'Image Scale'}: {options.imageScale}%</span>
                <input
                    type="range"
                    min="30"
                    max="100"
                    value={options.imageScale}
                    onChange={(e) => onChange({ imageScale: Number(e.target.value) })}
                    className="w-16 sm:w-20 accent-primary"
                />
            </div>

            <div className="flex items-center gap-2 text-xs sm:text-sm bg-muted/50 px-2 sm:px-3 py-1 rounded-md">
                <label htmlFor="print-preview-answer-space" className="whitespace-nowrap">
                    {t.exam.answerSpace}:
                </label>
                <select
                    id="print-preview-answer-space"
                    value={answerSpace}
                    onChange={(e) => {
                        if (isAnswerSpaceMode(e.target.value)) {
                            onChange({ answerSpace: e.target.value });
                        }
                    }}
                    className="bg-background border rounded px-2 py-0.5 text-xs sm:text-sm"
                >
                    <option value="auto">{t.exam.answerSpaceAuto}</option>
                    <option value="none">{t.exam.answerSpaceNone}</option>
                    <option value="small">{t.exam.answerSpaceSmall}</option>
                    <option value="medium">{t.exam.answerSpaceMedium}</option>
                    <option value="large">{t.exam.answerSpaceLarge}</option>
                </select>
                {hasCustomSpaces && onResetCustomSpaces && (
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onResetCustomSpaces}>
                        {t.exam.resetAllQuestionAnswerSpaces}
                    </Button>
                )}
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-1 sm:gap-4">
                <ToggleOption checked={options.showQuestionText} onChange={(v) => onChange({ showQuestionText: v })} label={t.printPreview?.showQuestionText || 'Question Text'} />
                <ToggleOption checked={options.showAnswers} onChange={(v) => onChange({ showAnswers: v })} label={t.printPreview?.showAnswers || 'Show Answers'} />
                <ToggleOption checked={options.showAnalysis} onChange={(v) => onChange({ showAnalysis: v })} label={t.printPreview?.showAnalysis || 'Show Analysis'} />
                <ToggleOption checked={options.showTags} onChange={(v) => onChange({ showTags: v })} label={t.printPreview?.showTags || 'Show Tags'} />
            </div>
        </div>
    );
}
