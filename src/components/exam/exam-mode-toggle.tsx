"use client";

import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ExamMode } from "@/types/api";

const MODES: ExamMode[] = ["generate", "original"];

interface ExamModeToggleProps {
    value: ExamMode;
    onChange: (mode: ExamMode) => void;
}

/** 组卷模式切换：举一反三 / 原题直出 */
export function ExamModeToggle({ value, onChange }: ExamModeToggleProps) {
    const { t } = useLanguage();
    return (
        <div className="space-y-2">
            <Label>{t.exam.modeLabel}</Label>
            <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 sm:max-w-sm" role="group" aria-label={t.exam.modeLabel}>
                {MODES.map((mode) => (
                    <button
                        key={mode}
                        type="button"
                        aria-pressed={value === mode}
                        onClick={() => onChange(mode)}
                        className={`rounded px-2 py-1.5 text-sm transition-colors ${value === mode ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
                    >
                        {t.exam.modes[mode]}
                    </button>
                ))}
            </div>
            {value === "original" && (
                <p className="text-xs text-muted-foreground">{t.exam.originalHint}</p>
            )}
        </div>
    );
}
