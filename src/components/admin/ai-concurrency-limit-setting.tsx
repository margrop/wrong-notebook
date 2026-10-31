"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { DEFAULT_AI_CONCURRENCY_LIMIT as DEFAULT_LIMIT, MAX_AI_CONCURRENCY_LIMIT as MAX_LIMIT, isValidConcurrencyLimit } from "@/lib/ai-concurrency-limit";
import { apiClient } from "@/lib/api-client";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import type { AppConfig } from "@/types/api";

/** 管理员设置：同一模型同时进行的 AI 调用上限，超出的调用排队 */
export function AiConcurrencyLimitSetting() {
    const { t } = useLanguage();
    const [value, setValue] = useState(String(DEFAULT_LIMIT));
    const [saving, setSaving] = useState(false);

    const fetchConfig = useCallback(async () => {
        try {
            const data = await apiClient.get<AppConfig>("/api/settings");
            setValue(String(data.aiConcurrencyLimit ?? DEFAULT_LIMIT));
        } catch (error) {
            frontendLogger.error('[AiConcurrencyLimitSetting]', 'Failed to fetch config', { error });
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面时加载当前设置
        fetchConfig();
    }, [fetchConfig]);

    const parsed = Number(value);
    const valid = value.trim() !== "" && isValidConcurrencyLimit(parsed);

    const handleSave = async () => {
        if (!valid) return;
        setSaving(true);
        try {
            await apiClient.post("/api/settings", { aiConcurrencyLimit: parsed });
            toast.success(t.admin.aiConcurrencyLimitSaved);
        } catch (error) {
            frontendLogger.error('[AiConcurrencyLimitSetting]', 'Failed to update AI concurrency limit', { error });
            toast.error(t.common.error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/30 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
                <Label htmlFor="ai-concurrency-limit" className="text-base">{t.admin.aiConcurrencyLimit}</Label>
                <p className="text-sm text-muted-foreground">{t.admin.aiConcurrencyLimitDesc}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <Input
                    id="ai-concurrency-limit"
                    type="number"
                    min={1}
                    max={MAX_LIMIT}
                    step={1}
                    inputMode="numeric"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    aria-invalid={!valid}
                    className="w-24"
                />
                <Button size="sm" onClick={handleSave} disabled={saving || !valid}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t.common.save}
                </Button>
            </div>
        </div>
    );
}
