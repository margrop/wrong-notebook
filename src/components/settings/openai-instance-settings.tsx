"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelSelector } from "@/components/ui/model-selector";
import { FieldLabel } from "@/components/settings/field-label";
import { PasswordInput } from "@/components/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { getProviderDocs } from "@/lib/ai/provider-docs";
import { confirmDialog } from "@/lib/feedback";
import type { AppConfig, OpenAIInstance } from "@/types/api";

type OpenAIConfig = NonNullable<AppConfig["openai"]>;

const MAX_OPENAI_INSTANCES = 10;

// 局域网 HTTP 访问时不是安全上下文，crypto.randomUUID 不可用，自行生成 UUID v4 格式的 ID
function generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

interface OpenAIInstanceSettingsProps {
    value?: OpenAIConfig;
    onChange: (value: OpenAIConfig) => void;
}

/** OpenAI 及兼容接口：最多 10 个实例，当前激活的实例用于识别 */
export function OpenAIInstanceSettings({ value, onChange }: OpenAIInstanceSettingsProps) {
    const { t } = useLanguage();
    const docs = getProviderDocs("openai");
    const instances = value?.instances || [];
    const activeId = value?.activeInstanceId;
    const selected = instances.find((instance) => instance.id === activeId);

    const updateSelected = (key: keyof OpenAIInstance, next: string) => {
        onChange({ ...value, instances: instances.map((instance) => instance.id === activeId ? { ...instance, [key]: next } : instance) });
    };

    const addInstance = () => {
        if (instances.length >= MAX_OPENAI_INSTANCES) return;
        const instance: OpenAIInstance = {
            id: generateId(),
            name: `Instance ${instances.length + 1}`,
            apiKey: '',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-6.1-sol',
        };
        onChange({ instances: [...instances, instance], activeInstanceId: instance.id });
    };

    const deleteSelected = async () => {
        if (!activeId || !(await confirmDialog(t.settings?.ai?.confirmDelete || 'Delete this instance?', { destructive: true }))) return;
        const rest = instances.filter((instance) => instance.id !== activeId);
        onChange({ instances: rest, activeInstanceId: rest[0]?.id });
    };

    return (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
            {/* 实例选择器 */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label>{t.settings?.ai?.instances || "Instance"}</Label>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addInstance}
                        disabled={instances.length >= MAX_OPENAI_INSTANCES}
                        className="h-7 px-2 text-xs"
                    >
                        <Plus className="h-3 w-3 mr-1" />
                        {t.settings?.ai?.addInstance || "Add"}
                    </Button>
                </div>
                {instances.length > 0 ? (
                    <div className="flex gap-2">
                        <Select value={activeId || ''} onValueChange={(id) => onChange({ ...value, activeInstanceId: id })}>
                            <SelectTrigger className="flex-1">
                                <SelectValue placeholder={t.settings?.ai?.selectInstance || "Select Instance"} />
                            </SelectTrigger>
                            <SelectContent>
                                {instances.map((instance) => (
                                    <SelectItem key={instance.id} value={instance.id}>
                                        {instance.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {instances.length > 1 && (
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={deleteSelected}
                                className="h-10 w-10 text-destructive hover:text-destructive"
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {t.settings?.ai?.noInstances || "No instances configured. Click 'Add' to create one."}
                    </p>
                )}
                {instances.length >= MAX_OPENAI_INSTANCES && (
                    <p className="text-xs text-amber-600">
                        {t.settings?.ai?.maxInstancesReached || "Maximum instances reached (10)"}
                    </p>
                )}
            </div>

            {/* 实例配置表单 */}
            {selected && (
                <div className="space-y-3 p-3 border rounded-md bg-background">
                    <div className="space-y-2">
                        <Label>{t.settings?.ai?.instanceName || "Instance Name"} <span className="text-destructive">*</span></Label>
                        <Input
                            value={selected.name || ''}
                            onChange={(e) => updateSelected('name', e.target.value)}
                            placeholder="e.g. GLM-4V"
                            className={!selected.name?.trim() ? 'border-destructive' : ''}
                        />
                    </div>
                    <div className="space-y-2">
                        <FieldLabel label={<>API Key <span className="text-destructive">*</span></>} href={docs?.apiKey} linkText={t.settings.ai.docLinks.apiKey} />
                        <PasswordInput
                            value={selected.apiKey || ''}
                            onChange={(e) => updateSelected('apiKey', e.target.value)}
                            placeholder="sk-..."
                            className={!selected.apiKey?.trim() ? 'border-destructive' : ''}
                        />
                    </div>
                    <div className="space-y-2 pt-4 border-t">
                        <Label>Base URL <span className="text-destructive">*</span></Label>
                        <Input
                            value={selected.baseUrl || ''}
                            onChange={(e) => updateSelected('baseUrl', e.target.value)}
                            placeholder="https://api.openai.com/v1"
                            className={!selected.baseUrl?.trim() ? 'border-destructive' : ''}
                        />
                    </div>
                    <ModelSelector
                        provider="openai"
                        apiKey={selected.apiKey}
                        baseUrl={selected.baseUrl}
                        currentModel={selected.model}
                        onModelChange={(model) => updateSelected('model', model)}
                        docsHref={docs?.models}
                    />
                </div>
            )}
        </div>
    );
}
