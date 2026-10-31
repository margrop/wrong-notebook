"use client";

import type { Dispatch, SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DuplicateThresholdSetting } from "@/components/settings/duplicate-threshold-setting";
import { GeogebraPreferenceSetting } from "@/components/settings/geogebra-preference-setting";
import { ImportPreferenceSetting } from "@/components/settings/import-preference-setting";
import { MasteryThresholdSetting } from "@/components/settings/mastery-threshold-setting";
import { QuestionGradeSetting } from "@/components/settings/question-grade-setting";
import { SvgAnimationPreferenceSetting } from "@/components/settings/svg-animation-preference-setting";
import { TimeZoneSetting } from "@/components/settings/time-zone-setting";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import type { AppConfig } from "@/types/api";

/** AI 识别超时的允许范围（秒） */
const MIN_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 600;

interface GeneralSettingsProps {
    config: AppConfig;
    setConfig: Dispatch<SetStateAction<AppConfig>>;
    isAdmin: boolean;
    /** 配置加载或保存中时禁用全局设置 */
    disabled: boolean;
}

/** 常规设置：界面语言、时区、AI 超时（管理员）以及个人偏好 */
export function GeneralSettings({ config, setConfig, isAdmin, disabled }: GeneralSettingsProps) {
    const { t, language, setLanguage } = useLanguage();
    const { timeZone } = useTimeZone();
    const setTimeoutSeconds = (seconds: number) => setConfig(prev => ({ ...prev, timeouts: { ...prev.timeouts, analyze: seconds * 1000 } }));

    return (
        <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
            <div className="space-y-2">
                <Label>{t.settings?.language || "Language"}</Label>
                <Select value={language} onValueChange={(val: 'zh' | 'en') => setLanguage(val)}>
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="zh">中文 (Chinese)</SelectItem>
                        <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <TimeZoneSetting value={config.timeZone ?? timeZone} onChange={(value) => setConfig((current) => ({ ...current, timeZone: value }))} disabled={!isAdmin || disabled} />

            {/* AI 超时是全局配置，只有管理员可以修改 */}
            {isAdmin && (
                <div className="space-y-2 pt-4 border-t">
                    <Label>{t.settings?.general?.timeoutLabel || "AI Analysis Timeout (Seconds)"}</Label>
                    <Input
                        type="number"
                        value={config.timeouts?.analyze ? config.timeouts.analyze / 1000 : ''}
                        onChange={(e) => {
                            // 输入时不限制范围，失去焦点时再校正
                            const val = e.target.value === '' ? 0 : parseInt(e.target.value);
                            setTimeoutSeconds(isNaN(val) ? 0 : val);
                        }}
                        onBlur={() => {
                            const current = (config.timeouts?.analyze || 0) / 1000;
                            const safe = Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, current));
                            if (safe !== current) setTimeoutSeconds(safe);
                        }}
                        min={MIN_TIMEOUT_SECONDS}
                        max={MAX_TIMEOUT_SECONDS}
                    />
                    <p className="text-xs text-muted-foreground">
                        {t.settings?.general?.timeoutDesc || "Increase this value if you experience frequent timeouts during AI analysis."}
                    </p>
                </div>
            )}

            <ImportPreferenceSetting />
            <QuestionGradeSetting />
            <SvgAnimationPreferenceSetting />
            <GeogebraPreferenceSetting />
            <DuplicateThresholdSetting />
            <MasteryThresholdSetting />
        </div>
    );
}
