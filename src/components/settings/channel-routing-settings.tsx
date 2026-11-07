"use client";

import type { Dispatch, SetStateAction } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProviderConfigForm } from "@/components/settings/provider-config-form";
import { AI_PROVIDER_IDS, aiProviderName, isProviderConfigured, resolveProviderAssignment } from "@/lib/ai/routing";
import type { AiRouteRole } from "@/lib/ai/routing";
import type { AiProviderId } from "@/lib/config/types";
import type { AppConfig } from "@/types/api";

interface ChannelRoutingSettingsProps {
    config: AppConfig;
    setConfig: Dispatch<SetStateAction<AppConfig>>;
}

/** 空字符串表示跟随默认渠道 */
const FOLLOW_DEFAULT = '__default__';

type RoutingKey = AiRouteRole | 'fallback';

/** 渠道分工：识别与文本分析分别使用哪个渠道，以及额度用完后自动切换的备用渠道 */
export function ChannelRoutingSettings({ config, setConfig }: ChannelRoutingSettingsProps) {
    const { t, language } = useLanguage();
    const texts = t.settings?.ai?.routing;
    const defaultLabel = `${texts?.followDefault || "Follow the default channel"} (${aiProviderName(config.aiProvider, language)})`;

    const update = (key: RoutingKey, value: string) => {
        setConfig((prev) => ({
            ...prev,
            routing: { ...prev.routing, [key]: value === FOLLOW_DEFAULT ? '' : value as AiProviderId },
        }));
    };

    /** 选择某个渠道后直接展开它的配置，省去在主渠道下拉里来回切换 */
    const configure = (provider: AiProviderId) => setConfig((prev) => ({ ...prev, aiProvider: provider }));

    const openaiHint = t.settings?.ai?.routingFallbackHint || "Used automatically when the main channel reports exhausted quota, an expired login, missing permission or lacks image support. Leave empty to disable.";

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{texts?.title || "Channel routing"}</CardTitle>
                <CardDescription>{texts?.desc || "Images need a vision model while text analysis can use a cheaper one. Route them to different channels to save cost; results are recorded per channel."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>{texts?.vision || "Image recognition"}</Label>
                    <Select value={config.routing?.vision || FOLLOW_DEFAULT} onValueChange={(value) => update('vision', value)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={FOLLOW_DEFAULT}>{defaultLabel}</SelectItem>
                            {AI_PROVIDER_IDS.map((id) => (
                                <SelectItem key={id} value={id}>{aiProviderName(id, language)}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{texts?.visionHint || "Question photos, figure redrawing and image splitting. The model must support images."}</p>
                </div>

                <div className="space-y-2">
                    <Label>{texts?.text || "Text analysis"}</Label>
                    <Select value={config.routing?.text || FOLLOW_DEFAULT} onValueChange={(value) => update('text', value)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={FOLLOW_DEFAULT}>{defaultLabel}</SelectItem>
                            {AI_PROVIDER_IDS.map((id) => (
                                <SelectItem key={id} value={id}>{aiProviderName(id, language)}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{texts?.textHint || "Solving, similar questions, grading and knowledge points. A cheaper text model is usually enough."}</p>
                </div>

                <div className="space-y-2">
                    <Label>{texts?.fallback || "Fallback channel"}</Label>
                    <Select value={config.routing?.fallback || FOLLOW_DEFAULT} onValueChange={(value) => update('fallback', value)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={FOLLOW_DEFAULT}>{texts?.noFallback || "Not used"}</SelectItem>
                            {AI_PROVIDER_IDS.map((id) => (
                                <SelectItem key={id} value={id}>{aiProviderName(id, language)}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{openaiHint}</p>
                </div>

                <RoutingPreview config={config} setConfig={setConfig} configure={configure} />
            </CardContent>
        </Card>
    );
}

interface RoutingPreviewProps {
    config: AppConfig;
    setConfig: Dispatch<SetStateAction<AppConfig>>;
    configure: (provider: AiProviderId) => void;
}

/** 显示分工后实际使用的渠道；某个渠道还没配置时就在下面直接填写 */
function RoutingPreview({ config, setConfig, configure }: RoutingPreviewProps) {
    const { t, language } = useLanguage();
    const texts = t.settings?.ai?.routing;
    const vision = resolveProviderAssignment(config, 'vision');
    const text = resolveProviderAssignment(config, 'text');
    const providers = Array.from(new Set([vision.primary, vision.fallback, text.primary, text.fallback].filter((id): id is AiProviderId => Boolean(id))));
    const unconfigured = providers.filter((id) => !isProviderConfigured(config, id));
    // 主渠道的配置表单已经显示在「渠道分工」上方，这里不再重复渲染，避免同一渠道出现两份输入框
    const inlineForms = unconfigured.filter((id) => id !== config.aiProvider);

    const summary = (assignment: { primary: AiProviderId; fallback: AiProviderId | null }) =>
        assignment.fallback
            ? aiProviderName(assignment.primary, language) + ' → ' + aiProviderName(assignment.fallback, language)
            : aiProviderName(assignment.primary, language);

    return (
        <div className="space-y-3 rounded-md border bg-background p-3 text-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                <span className="text-muted-foreground">{texts?.currentVision || "Recognition uses"}</span>
                <span className="font-medium break-all">{summary(vision)}</span>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
                <span className="text-muted-foreground">{texts?.currentText || "Text analysis uses"}</span>
                <span className="font-medium break-all">{summary(text)}</span>
            </div>
            {unconfigured.length > 0 && (
                <div className="space-y-3 border-t pt-3">
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                        {(texts?.configureMissing || "These channels are used but not configured yet: {names}").replace(
                            '{names}',
                            unconfigured.map((id) => aiProviderName(id, language)).join(texts?.listSeparator || ", "),
                        )}
                    </p>
                    {unconfigured.includes(config.aiProvider) && (
                        <p className="text-xs text-muted-foreground">
                            {texts?.fillCurrentAbove || "Fill in the channel settings above."}
                        </p>
                    )}
                    {inlineForms.map((id) => (
                        <div key={id} className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium">{aiProviderName(id, language)}</span>
                                <button type="button" className="text-xs underline text-muted-foreground" onClick={() => configure(id)}>
                                    {texts?.useAsDefault || "Use as main channel"}
                                </button>
                            </div>
                            <ProviderConfigForm provider={id} config={config} setConfig={setConfig} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}