"use client";

import { LibraryBig, Sparkles, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { PracticeSource } from "@/lib/hooks/use-practice-session";

interface PracticeSourcePickerProps {
    value: PracticeSource;
    onChange: (value: PracticeSource) => void;
    disabled?: boolean;
}

/** 举一反三出题来源：AI 生成变式题、从真题库按知识点选题，或基于真题库题目生成变式题 */
export function PracticeSourcePicker({ value, onChange, disabled }: PracticeSourcePickerProps) {
    const { t } = useLanguage();
    return (
        <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label={t.practice.sourceLabel}>
            <Button
                type="button"
                size="sm"
                variant={value === "ai" ? "default" : "outline"}
                onClick={() => onChange("ai")}
                disabled={disabled}
            >
                <Sparkles className="mr-2 h-4 w-4" />
                {t.practice.sourceAi}
            </Button>
            <Button
                type="button"
                size="sm"
                variant={value === "bank" ? "default" : "outline"}
                onClick={() => onChange("bank")}
                disabled={disabled}
            >
                <LibraryBig className="mr-2 h-4 w-4" />
                {t.practice.sourceBank}
            </Button>
            <Button
                type="button"
                size="sm"
                variant={value === "bankVariant" ? "default" : "outline"}
                onClick={() => onChange("bankVariant")}
                disabled={disabled}
            >
                <WandSparkles className="mr-2 h-4 w-4" />
                {t.practice.sourceBankVariant}
            </Button>
        </div>
    );
}
