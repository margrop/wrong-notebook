"use client";

import { ChevronDown, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ErrorListFilters, TimeFilter } from "@/lib/error-list/error-list-filters";

interface FilterMenuProps {
    mastery: ErrorListFilters["mastery"];
    timeRange: TimeFilter;
    onMasteryChange: (value: ErrorListFilters["mastery"]) => void;
    onTimeRangeChange: (value: TimeFilter) => void;
}

/** 按复习状态和录入时间筛选的下拉菜单 */
export function FilterMenu({ mastery, timeRange, onMasteryChange, onTimeRangeChange }: FilterMenuProps) {
    const { t } = useLanguage();
    const masteryOptions = [
        { value: "all", label: t.filter.all || "All" },
        { value: "new", label: t.filter.review || "To Review" },
        { value: "reviewing", label: t.filter.reviewing || "Reviewing" },
        { value: "mastered", label: t.filter.mastered || "Mastered" },
    ] as const;
    const timeOptions = [
        { value: "all", label: t.filter.allTime || "All Time" },
        { value: "week", label: t.filter.lastWeek || "Last Week" },
        { value: "month", label: t.filter.lastMonth || "Last Month" },
    ] as const;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-10">
                    <Filter className="mr-2 h-4 w-4" />
                    {t.notebook.filter}
                    <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>{t.filter.masteryStatus || "Mastery Status"}</DropdownMenuLabel>
                {masteryOptions.map(({ value, label }) => (
                    <DropdownMenuItem key={value} onClick={() => onMasteryChange(value)}>
                        {mastery === value && "✓ "}{label}
                    </DropdownMenuItem>
                ))}

                <DropdownMenuSeparator />

                <DropdownMenuLabel>{t.filter.timeRange || "Time Range"}</DropdownMenuLabel>
                {timeOptions.map(({ value, label }) => (
                    <DropdownMenuItem key={value} onClick={() => onTimeRangeChange(value)}>
                        {timeRange === value && "✓ "}{label}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
