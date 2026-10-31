"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { isThemePreference, THEME_PREFERENCES } from "@/lib/theme";
import type { ThemePreference } from "@/lib/theme";

const ICONS: Record<ThemePreference, LucideIcon> = {
    system: Monitor,
    light: Sun,
    dark: Moon,
};

/** 导航栏的主题切换：自动（跟随系统）、浅色、深色 */
export function ThemeToggle() {
    const { t } = useLanguage();
    const { preference, setPreference } = useTheme();
    const CurrentIcon = ICONS[preference];
    const label = `${t.theme.toggle}: ${t.theme[preference]}`;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full" title={label} aria-label={label}>
                    <CurrentIcon className="h-5 w-5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                    value={preference}
                    onValueChange={(value) => {
                        if (isThemePreference(value)) setPreference(value);
                    }}
                >
                    {THEME_PREFERENCES.map((option) => {
                        const Icon = ICONS[option];
                        return (
                            <DropdownMenuRadioItem key={option} value={option} className="gap-2">
                                <Icon className="h-4 w-4" />
                                {t.theme[option]}
                            </DropdownMenuRadioItem>
                        );
                    })}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
