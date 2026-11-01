"use client";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import {
    CUSTOM_ANSWER_SPACE_STEP_PX,
    MAX_CUSTOM_ANSWER_SPACE_PX,
    MIN_CUSTOM_ANSWER_SPACE_PX,
    clampAnswerSpacePx,
} from "@/lib/exam-answer-space";

interface AnswerSpaceControlProps {
    /** 当前生效的留白高度（px） */
    effectivePx: number;
    /** 是否由用户手动覆盖了本题留白 */
    isCustom: boolean;
    /** 手动调整本题留白高度 */
    onChange: (px: number) => void;
    /** 恢复全局/自动留白 */
    onReset: () => void;
}

/** 单题留白高度调节条（仅在屏幕预览时显示，打印与导出 HTML 时隐藏） */
export function AnswerSpaceControl({
    effectivePx,
    isCustom,
    onChange,
    onReset,
}: AnswerSpaceControlProps) {
    const { t } = useLanguage();
    const clamped = clampAnswerSpacePx(effectivePx);

    return (
        <div className="answer-space-controls print:hidden flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-2 pt-1">
            <span>
                {t.exam.questionAnswerSpace}: {clamped}px
            </span>
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                aria-label={t.exam.decreaseAnswerSpace}
                disabled={clamped <= MIN_CUSTOM_ANSWER_SPACE_PX}
                onClick={() => onChange(clampAnswerSpacePx(clamped - CUSTOM_ANSWER_SPACE_STEP_PX))}
            >
                -
            </Button>
            <input
                type="range"
                min={MIN_CUSTOM_ANSWER_SPACE_PX}
                max={MAX_CUSTOM_ANSWER_SPACE_PX}
                step={10}
                value={clamped}
                aria-label={t.exam.questionAnswerSpaceSlider}
                onChange={(event) => onChange(clampAnswerSpacePx(Number(event.target.value)))}
                className="w-24 sm:w-32 accent-primary"
            />
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs"
                aria-label={t.exam.increaseAnswerSpace}
                disabled={clamped >= MAX_CUSTOM_ANSWER_SPACE_PX}
                onClick={() => onChange(clampAnswerSpacePx(clamped + CUSTOM_ANSWER_SPACE_STEP_PX))}
            >
                +
            </Button>
            {isCustom && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={onReset}
                >
                    {t.exam.resetQuestionAnswerSpace}
                </Button>
            )}
        </div>
    );
}
