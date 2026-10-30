"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ExternalLink, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProviderErrorDetail } from "@/components/settings/provider-error-detail";
import { useLanguage } from "@/contexts/LanguageContext";
import { getVendorName } from "@/lib/ai/vendor-presets";
import { apiClient } from "@/lib/api-client";
import { getSpeechAudio, unlockSpeechAudio } from "@/lib/cloud-speech";
import { getApiErrorDetails, getApiErrorMessage } from "@/lib/error-message";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { CLOUD_TTS_DEFAULTS, CLOUD_TTS_DOCS, TTS_MODES, defaultTtsEndpoint, hasOwnTtsApiKey, isCloudTtsProvider } from "@/lib/tts/constants";
import type { CloudTtsSettings, TtsMode } from "@/lib/tts/constants";
import type { AppConfig } from "@/types/api";

interface FieldLabelProps {
    label: string;
    /** 该字段的官方说明文档（可选值列表等） */
    href: string;
    linkText: string;
}

/** 字段名，右侧附官方文档链接，便于查询可选的模型、音色和接口地址 */
function FieldLabel({ label, href, linkText }: FieldLabelProps) {
    return (
        <div className="flex items-center justify-between gap-2">
            <Label>{label}</Label>
            <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline">
                {linkText}
                <ExternalLink className="h-3 w-3" />
            </a>
        </div>
    );
}

interface TtsSettingsProps {
    config: AppConfig;
    setConfig: Dispatch<SetStateAction<AppConfig>>;
    saving: boolean;
    onSave: () => Promise<void>;
}

/**
 * 动画语音讲解的朗读方式（管理员）：浏览器本地语音，或由服务端调用 MiniMax、千问等渠道的语音合成。
 * 云端语音的 API Key 与「AI 设置」中对应渠道共用
 */
export function TtsSettings({ config, setConfig, saving, onSave }: TtsSettingsProps) {
    const { t, language } = useLanguage();
    const texts = t.settings.tts;
    const [previewing, setPreviewing] = useState(false);
    // 试听失败时服务商的原始报错，显示在按钮下方便于排查
    const [previewError, setPreviewError] = useState<string | null>(null);
    const mode: TtsMode = config.tts?.mode ?? "browser";
    const provider = isCloudTtsProvider(mode) ? mode : null;
    const settings = provider ? config.tts?.[provider] : undefined;

    const updateSettings = (key: keyof CloudTtsSettings, value: string) => {
        if (!provider) return;
        setConfig((prev) => ({ ...prev, tts: { ...prev.tts, [provider]: { ...prev.tts?.[provider], [key]: value } } }));
    };
    // 豆包语音的 Key 保存在语音设置中；其他语音与对应 AI 渠道共用 Key
    const ownApiKey = provider ? hasOwnTtsApiKey(provider) : false;
    const apiKey = provider ? (ownApiKey ? settings?.apiKey : config[provider]?.apiKey) : undefined;
    const updateApiKey = (value: string) => {
        if (!provider) return;
        if (ownApiKey) updateSettings("apiKey", value);
        else setConfig((prev) => ({ ...prev, [provider]: { ...prev[provider], apiKey: value } }));
    };

    // 试听前先保存，服务端按保存后的设置合成；在点击中先解锁播放（iOS Safari）
    const preview = async () => {
        unlockSpeechAudio();
        setPreviewing(true);
        setPreviewError(null);
        try {
            await onSave();
            const { id, version } = await apiClient.post<{ id: string; version: number }>("/api/tts", { text: texts.previewText, language }, { timeout: 120000, recoverable: true });
            const audio = getSpeechAudio();
            if (!audio) return;
            audio.src = `/api/tts/${id}?v=${version}`;
            audio.playbackRate = 1;
            await audio.play();
        } catch (error) {
            frontendLogger.error("[TtsSettings]", "Preview failed", { error });
            const code = getApiErrorMessage(error);
            toast.error(code === "TTS_NOT_CONFIGURED" ? texts.notConfigured : code === "TTS_PROVIDER_ERROR" ? texts.providerError : texts.previewFailed);
            setPreviewError(getApiErrorDetails(error) ?? null);
        } finally {
            setPreviewing(false);
        }
    };

    return (
        <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
            <div className="space-y-2">
                <Label>{texts.title}</Label>
                <Select
                    value={mode}
                    onValueChange={(value: TtsMode) => setConfig((prev) => ({ ...prev, tts: { ...prev.tts, mode: value } }))}
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {TTS_MODES.map((value) => (
                            <SelectItem key={value} value={value}>{texts.modes[value]}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{provider ? texts.cloudHint : texts.browserHint}</p>
            </div>

            {provider && (
                <div key={provider} className="space-y-3 animate-in fade-in slide-in-from-top-2">
                    <div className="space-y-2">
                        <Label>{ownApiKey ? texts.speechApiKey : `${getVendorName(provider, language)} API Key`}</Label>
                        <PasswordInput
                            value={apiKey || ""}
                            onChange={(e) => updateApiKey(e.target.value)}
                            placeholder={provider === "qwen" ? "sk-sp-..." : ownApiKey ? "" : "sk-..."}
                        />
                        <p className="text-xs text-muted-foreground">{texts.apiKeyHint[provider]}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                            <FieldLabel label={texts.model} href={CLOUD_TTS_DOCS[provider].model} linkText={texts.docs} />
                            <Input
                                value={settings?.model || ""}
                                onChange={(e) => updateSettings("model", e.target.value)}
                                placeholder={CLOUD_TTS_DEFAULTS[provider].model}
                            />
                        </div>
                        <div className="space-y-2">
                            <FieldLabel label={texts.voice} href={CLOUD_TTS_DOCS[provider].voice} linkText={texts.voiceList} />
                            <Input
                                value={settings?.voice || ""}
                                onChange={(e) => updateSettings("voice", e.target.value)}
                                placeholder={CLOUD_TTS_DEFAULTS[provider].voice}
                            />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{texts.voiceHint[provider]}</p>
                    <div className="space-y-2">
                        <FieldLabel label={texts.endpoint} href={CLOUD_TTS_DOCS[provider].endpoint} linkText={texts.docs} />
                        <Input
                            value={settings?.endpoint || ""}
                            onChange={(e) => updateSettings("endpoint", e.target.value)}
                            placeholder={defaultTtsEndpoint(provider, config[provider])}
                        />
                        <p className="text-xs text-muted-foreground">{texts.endpointHint}</p>
                    </div>
                </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
                {provider && (
                    <Button variant="outline" onClick={preview} disabled={saving || previewing} className="sm:w-auto">
                        {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                        {texts.preview}
                    </Button>
                )}
                <Button onClick={() => void onSave()} disabled={saving || previewing} className="flex-1">
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {texts.save}
                </Button>
            </div>
            {provider && previewError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/40">
                    <ProviderErrorDetail detail={previewError} />
                </div>
            )}
        </div>
    );
}
