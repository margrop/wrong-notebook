"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { formatDateTime } from "@/lib/date-time";
import type { TelemetryRecentError, TelemetryRecentEvent } from "@/lib/telemetry/types";

interface TelemetryRecordsProps {
    events: TelemetryRecentEvent[];
    errors: TelemetryRecentError[];
    disabled: boolean;
    onClear: () => void;
}

/** “本实例收集了什么”：最近 20 条事件和错误，以及立即清空 */
export function TelemetryRecords({ events, errors, disabled, onClear }: TelemetryRecordsProps) {
    const { t } = useLanguage();
    const { timeZone } = useTimeZone();
    const text = t.telemetrySettings;
    const time = (iso: string) => formatDateTime(iso, "MM-dd HH:mm", timeZone);
    const sentLabel = (forwardedAt: string | null) => (forwardedAt ? text.forwarded : text.notForwarded);
    const empty = events.length === 0 && errors.length === 0;

    return (
        <details className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer font-medium">{text.recentTitle}</summary>
            <div className="mt-3 space-y-3">
                {empty && <p className="text-xs text-muted-foreground">{text.recentEmpty}</p>}
                {events.length > 0 && (
                    <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">{text.recentEvents}</p>
                        <ul className="space-y-1 font-mono text-xs">
                            {events.map((event) => (
                                <li key={event.id} className="break-all">
                                    {time(event.createdAt)} {event.name} {event.payload ?? ""} · {sentLabel(event.forwardedAt)}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {errors.length > 0 && (
                    <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">{text.recentErrors}</p>
                        <ul className="space-y-1 font-mono text-xs">
                            {errors.map((error) => (
                                <li key={error.id} className="break-all">
                                    {time(error.createdAt)} {error.kind} {error.scope} {error.name} #{error.fingerprint}
                                    {error.path ? ` ${error.path}` : ""}{error.message ? ` — ${error.message}` : ""} · {sentLabel(error.forwardedAt)}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <Button variant="outline" size="sm" onClick={onClear} disabled={disabled || empty}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {text.clear}
                </Button>
            </div>
        </details>
    );
}
