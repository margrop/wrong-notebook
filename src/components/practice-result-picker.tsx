"use client";

import { CheckCircle, HelpCircle, XCircle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { PracticeResult } from "@/types/api";

interface PracticeResultPickerProps {
    value: PracticeResult | null;
    onChange: (value: PracticeResult) => void;
    disabled?: boolean;
    size?: "sm" | "md";
}

const OPTIONS: { value: PracticeResult; icon: typeof CheckCircle; active: string }[] = [
    { value: "correct", icon: CheckCircle, active: "border-green-600 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300" },
    { value: "wrong", icon: XCircle, active: "border-red-600 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300" },
    { value: "not_attempted", icon: HelpCircle, active: "border-amber-600 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300" },
];

/** 做对 / 做错 / 不会做 三选一 */
export function PracticeResultPicker({ value, onChange, disabled, size = "md" }: PracticeResultPickerProps) {
    const { t } = useLanguage();
    const padding = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm";

    return (
        <div className="grid grid-cols-3 gap-2" role="radiogroup">
            {OPTIONS.map(({ value: option, icon: Icon, active }) => (
                <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={value === option}
                    disabled={disabled}
                    onClick={() => onChange(option)}
                    className={`flex items-center justify-center gap-1 rounded-md border font-medium transition-colors disabled:opacity-60 ${padding} ${value === option ? active : "border-input hover:bg-muted"}`}
                >
                    <Icon className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} />
                    {t.mastery.results[option]}
                </button>
            ))}
        </div>
    );
}
