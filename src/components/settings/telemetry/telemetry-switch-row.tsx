"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface TelemetrySwitchRowProps {
    id: string;
    label: string;
    description: string;
    checked: boolean;
    disabled: boolean;
    onCheckedChange: (checked: boolean) => void;
}

/** 一行开关：标题、说明与右侧开关 */
export function TelemetrySwitchRow({ id, label, description, checked, disabled, onCheckedChange }: TelemetrySwitchRowProps) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
                <Label htmlFor={id} className="font-medium">{label}</Label>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} className="shrink-0" />
        </div>
    );
}
