"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePaperGroups } from "@/lib/use-paper-groups";

interface PaperGroupSelectProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}

/** 卷别分组下拉：动态加载当前用户的活跃分组 */
export function PaperGroupSelect({ value, onChange, disabled }: PaperGroupSelectProps) {
    const { groups, loading } = usePaperGroups();
    const activeGroups = groups.filter((g) => g.isActive);

    return (
        <Select value={value} onValueChange={onChange} disabled={disabled || loading}>
            <SelectTrigger>
                <SelectValue placeholder="选择卷别" />
            </SelectTrigger>
            <SelectContent>
                {activeGroups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                        {group.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
