"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/contexts/LanguageContext";

interface FigureReviewSettingProps {
    value: boolean;
    onChange: (value: boolean) => void;
    disabled: boolean;
}

/** AI 配图比对校正（系统设置）：重绘后把原图与结果并排交给 AI 比对修正；默认关闭，非管理员禁用 */
export function FigureReviewSetting({ value, onChange, disabled }: FigureReviewSettingProps) {
    const { t } = useLanguage();
    const texts = t.settings.general;
    return (
        <div className="space-y-2 pt-4 border-t">
            <div className="flex items-center justify-between gap-4">
                <Label htmlFor="figure-review">{texts.figureReviewLabel}</Label>
                <Switch id="figure-review" checked={value} onCheckedChange={onChange} disabled={disabled} />
            </div>
            <p className="text-xs text-muted-foreground">{texts.figureReviewDesc}</p>
        </div>
    );
}
