"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { EulaConsentDialog } from "@/components/eula/eula-consent-dialog";
import { TelemetryEndpointForm } from "@/components/settings/telemetry/telemetry-endpoint-form";
import { TelemetryRecords } from "@/components/settings/telemetry/telemetry-records";
import { TelemetrySwitchRow } from "@/components/settings/telemetry/telemetry-switch-row";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { formatDateTime } from "@/lib/date-time";
import { getApiErrorMessage } from "@/lib/error-message";
import { confirmDialog, toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { useTelemetryAdmin } from "@/lib/hooks/use-telemetry-admin";
import { trackEvent } from "@/lib/telemetry/client";
import type { TelemetryChanges } from "@/lib/hooks/use-telemetry-admin";

/** 管理员“隐私与遥测”分区：协议状态、三个开关、外发地址与保留天数、本实例收集的记录 */
export function TelemetrySettings() {
    const { t } = useLanguage();
    const { timeZone } = useTimeZone();
    const text = t.telemetrySettings;
    const { data, update, enableWithConsent, clear } = useTelemetryAdmin();
    const [busy, setBusy] = useState(false);
    const [consentOpen, setConsentOpen] = useState(false);

    const run = async (action: () => Promise<void>, success: string) => {
        setBusy(true);
        try {
            await action();
            toast.success(success);
        } catch (error) {
            frontendLogger.error("[TelemetrySettings]", "Telemetry action failed", { error });
            toast.error(getApiErrorMessage(error) === "INVALID_TELEMETRY_ENDPOINT" ? text.invalidEndpoint : text.failed);
            throw error;
        } finally {
            setBusy(false);
        }
    };
    const save = (changes: TelemetryChanges) => run(async () => {
        await update(changes);
        trackEvent("settings_changed", { section: "telemetry" });
    }, text.saved).catch(() => undefined);

    if (!data) return null;
    const locked = data.lockedByEnv;
    const disabled = busy || locked;
    const time = (iso: string) => formatDateTime(iso, "yyyy-MM-dd HH:mm", timeZone);

    const handleForwarding = (checked: boolean) => {
        // 未同意过协议（或协议已升级）时，先弹出协议对话框
        if (checked && (!data.eula.acceptedVersion || data.consentPending)) {
            setConsentOpen(true);
            return;
        }
        save({ forwarding: checked });
    };
    const handleClear = async () => {
        if (!(await confirmDialog(text.clearConfirm))) return;
        run(clear, text.cleared).catch(() => undefined);
    };

    let flushInfo = data.lastFlushAt ? text.lastFlush.replace("{time}", time(data.lastFlushAt)) : text.neverFlushed;
    if (data.lastAttempt?.status === "failed") flushInfo = text.lastAttemptFailed.replace("{status}", String(data.lastAttempt.httpStatus ?? "network"));
    if (data.lastAttempt?.status === "stopped") flushInfo = text.lastAttemptStopped;

    return (
        <div className="space-y-4 rounded-lg border p-4">
            <div className="space-y-1">
                <p className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4" />{text.title}</p>
                <p className="text-xs text-muted-foreground">{text.desc}</p>
            </div>
            {locked && <p className="text-xs text-orange-600">{text.lockedByEnv}</p>}
            {data.consentPending && <p className="text-xs text-orange-600">{text.consentPending}</p>}
            <p className="text-xs text-muted-foreground">
                {data.eula.acceptedVersion
                    ? text.eulaStatus.replace("{version}", data.eula.acceptedVersion).replace("{time}", data.eula.acceptedAt ? time(data.eula.acceptedAt) : "-")
                    : text.eulaNotAccepted}
                {" "}<a href="/eula" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{text.viewEula}</a>
            </p>

            <TelemetrySwitchRow id="telemetry-forwarding" label={text.forwarding} description={text.forwardingDesc}
                checked={data.forwarding} disabled={disabled} onCheckedChange={handleForwarding} />
            {data.forwarding && (
                <p className="text-xs text-muted-foreground">{text.pending.replace("{count}", String(data.pending))} · {flushInfo}</p>
            )}
            <TelemetrySwitchRow id="telemetry-recording" label={text.recording} description={text.recordingDesc}
                checked={data.recording} disabled={disabled} onCheckedChange={(recording) => save({ recording })} />
            <TelemetrySwitchRow id="telemetry-errors" label={text.errors} description={text.errorsDesc}
                checked={data.errors} disabled={disabled} onCheckedChange={(errors) => save({ errors })} />

            <TelemetryEndpointForm endpoint={data.endpoint} retentionDays={data.retentionDays} disabled={disabled} onSave={save} />
            <TelemetryRecords events={data.events} errors={data.errorRecords} disabled={busy} onClear={handleClear} />

            <EulaConsentDialog
                open={consentOpen}
                onOpenChange={setConsentOpen}
                onConfirm={() => run(() => enableWithConsent(data.eula.current), text.enabled)}
            />
        </div>
    );
}
