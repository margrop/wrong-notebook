"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TelemetryChanges } from "@/lib/hooks/use-telemetry-admin";

interface TelemetryEndpointFormProps {
    endpoint: string;
    retentionDays: number;
    disabled: boolean;
    onSave: (changes: TelemetryChanges) => Promise<void>;
}

/** 外发地址（默认官方，可展开改成自建）与本地记录保留天数 */
export function TelemetryEndpointForm({ endpoint, retentionDays, disabled, onSave }: TelemetryEndpointFormProps) {
    const { t } = useLanguage();
    const text = t.telemetrySettings;
    const [customizing, setCustomizing] = useState(endpoint !== "");
    const [endpointDraft, setEndpointDraft] = useState(endpoint);
    const [daysDraft, setDaysDraft] = useState(String(retentionDays));

    const days = Number(daysDraft);
    const daysValid = Number.isInteger(days) && days >= 1 && days <= 365;

    return (
        <div className="space-y-3">
            <div className="space-y-1">
                <Label htmlFor="telemetry-endpoint">{text.endpoint}</Label>
                {customizing ? (
                    <>
                        <Input
                            id="telemetry-endpoint"
                            value={endpointDraft}
                            placeholder={text.endpointPlaceholder}
                            disabled={disabled}
                            onChange={(e) => setEndpointDraft(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">{text.endpointHint}</p>
                    </>
                ) : (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-muted-foreground">{text.endpointDefault}</span>
                        <Button variant="link" size="sm" className="h-auto p-0" disabled={disabled} onClick={() => setCustomizing(true)}>
                            {text.endpointCustomize}
                        </Button>
                    </div>
                )}
            </div>
            <div className="space-y-1">
                <Label htmlFor="telemetry-retention">{text.retentionDays}</Label>
                <Input
                    id="telemetry-retention"
                    type="number"
                    min={1}
                    max={365}
                    className="w-32"
                    value={daysDraft}
                    disabled={disabled}
                    onChange={(e) => setDaysDraft(e.target.value)}
                />
            </div>
            <Button
                size="sm"
                variant="outline"
                disabled={disabled || !daysValid}
                onClick={() => onSave({ endpoint: endpointDraft.trim(), retentionDays: days })}
            >
                {text.save}
            </Button>
        </div>
    );
}
