"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePaperGroups } from "@/lib/hooks/use-paper-groups";

interface PaperGroupSelectProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    allowUnspecified?: boolean;
}

const UNSPECIFIED = "__unspecified__";

/** 卷别分组下拉：动态加载当前用户的活跃分组 */
export function PaperGroupSelect({ value, onChange, disabled, allowUnspecified }: PaperGroupSelectProps) {
    const { t } = useLanguage();
    const { groups, loading, error } = usePaperGroups();
    const activeGroups = groups.filter((g) => g.isActive);
    const activeValue = activeGroups.some((group) => group.id === value) ? value : "";
    const unavailable = value && !activeValue && !loading && !error;

    return (
        <Select value={activeValue} onValueChange={(id) => onChange(id === UNSPECIFIED ? "" : id)} disabled={disabled || loading}>
            <SelectTrigger aria-label={t.editor.paperLevel}>
                <SelectValue placeholder={unavailable ? t.editor.paperLevelUnavailable : t.editor.paperLevelPlaceholder} />
            </SelectTrigger>
            <SelectContent>
                {allowUnspecified && <SelectItem value={UNSPECIFIED}>{t.editor.paperLevelUnspecified}</SelectItem>}
                {activeGroups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                        {group.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
