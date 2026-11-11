"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { QUESTION_NUMBERING_MODES, isQuestionNumbering } from "@/lib/seq-no/seq-no-format";
import type { QuestionNumbering } from "@/lib/seq-no/seq-no-format";

interface QuestionNumberingSettingProps {
    value: QuestionNumbering;
    onChange: (value: QuestionNumbering) => void;
    disabled: boolean;
}

/** 题目编号显示方式（系统设置）：6 位随机 ID 或流水号；两种编号都会保存，切换只影响显示 */
export function QuestionNumberingSetting({ value, onChange, disabled }: QuestionNumberingSettingProps) {
    const { t } = useLanguage();
    const texts = t.settings.general;
    return (
        <div className="space-y-2 pt-4 border-t">
            <Label htmlFor="question-numbering">{texts.questionNumberingLabel}</Label>
            <Select value={value} onValueChange={(next) => { if (isQuestionNumbering(next)) onChange(next); }} disabled={disabled}>
                <SelectTrigger id="question-numbering">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {QUESTION_NUMBERING_MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>{texts.questionNumberingOptions[mode]}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{texts.questionNumberingDesc}</p>
        </div>
    );
}
