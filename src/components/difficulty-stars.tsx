"use client";

import { Star } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

const STAR_VALUES = [1, 2, 3, 4, 5] as const;

interface DifficultyStarsProps {
    value: number | null | undefined;
    /** 提供时可点击修改；再次点击当前星级会清除（传入 null） */
    onChange?: (value: number | null) => void;
    disabled?: boolean;
    size?: "sm" | "md";
    /** 未评级时是否显示「未评级」文字 */
    showUnrated?: boolean;
    className?: string;
}

/** 难度星级（1~5 星，参考高思导引） */
export function DifficultyStars({ value, onChange, disabled, size = "sm", showUnrated = true, className }: DifficultyStarsProps) {
    const { t } = useLanguage();
    const stars = value ?? 0;
    const iconClass = size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5";
    const label = stars ? t.difficulty.starsLabel.replace("{n}", String(stars)) : t.difficulty.unrated;

    if (!onChange) {
        if (!stars) {
            return showUnrated ? <span className={cn("text-xs text-muted-foreground", className)}>{t.difficulty.unrated}</span> : null;
        }
        return (
            <span className={cn("inline-flex items-center", className)} role="img" aria-label={`${t.difficulty.label}${t.common.colon}${label}`} title={label}>
                {STAR_VALUES.map((n) => (
                    <Star key={n} className={cn(iconClass, n <= stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")} aria-hidden />
                ))}
            </span>
        );
    }

    return (
        <span className={cn("inline-flex items-center gap-0.5", className)} role="group" aria-label={`${t.difficulty.label}${t.common.colon}${label}`} title={t.difficulty.clearHint}>
            {STAR_VALUES.map((n) => (
                <button
                    key={n}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(n === stars ? null : n)}
                    aria-label={t.difficulty.setStars.replace("{n}", String(n))}
                    aria-pressed={n <= stars}
                    className="rounded p-0.5 hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Star className={cn(iconClass, n <= stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
                </button>
            ))}
            {!stars && showUnrated && <span className="ml-1 text-xs text-muted-foreground">{t.difficulty.unrated}</span>}
        </span>
    );
}
