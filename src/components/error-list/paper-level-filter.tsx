"use client";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePaperGroups } from "@/lib/use-paper-groups";

interface PaperLevelFilterProps {
    value: string;
    onChange: (value: string) => void;
}

/** 按卷别分组筛选的标签按钮，动态渲染当前用户的活跃分组 */
export function PaperLevelFilter({ value, onChange }: PaperLevelFilterProps) {
    const { t } = useLanguage();
    const { groups, loading } = usePaperGroups();
    const activeGroups = groups.filter((g) => g.isActive);

    if (loading) return null;

    return (
        <div className="flex flex-wrap gap-2">
            <Button
                variant={value === "all" ? "default" : "outline"}
                size="sm"
                className="rounded-full"
                onClick={() => onChange("all")}
            >
                {t.filter.all || "All"}
            </Button>
            {activeGroups.map((group) => (
                <Button
                    key={group.id}
                    variant={value === group.id ? "default" : "outline"}
                    size="sm"
                    className="rounded-full"
                    onClick={() => onChange(group.id)}
                >
                    {group.name}
                </Button>
            ))}
        </div>
    );
}
