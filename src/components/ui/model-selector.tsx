"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ExternalLink, RefreshCw, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { AIModel, ModelsResponse } from "@/types/api";
import { useLanguage } from "@/contexts/LanguageContext";
import { isVendorProvider, VENDOR_PRESETS } from "@/lib/ai/vendor-presets";
import type { VendorProviderId } from "@/lib/ai/vendor-presets";
import { frontendLogger } from "@/lib/frontend-logger";

interface ModelSelectorProps {
    provider: 'openai' | 'gemini' | 'anthropic' | VendorProviderId;
    apiKey?: string;
    baseUrl?: string;
    currentModel?: string;
    onModelChange: (model: string) => void;
    /** 官方的模型列表文档，显示在字段名旁 */
    docsHref?: string;
}

export function ModelSelector({ provider, apiKey, baseUrl, currentModel, onModelChange, docsHref }: ModelSelectorProps) {
    const { t } = useLanguage();
    const [models, setModels] = useState<AIModel[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [customModel, setCustomModel] = useState(currentModel || '');
    const [useCustom, setUseCustom] = useState(false);

    // 当外部 currentModel 变化时同步更新 customModel（用于实例切换），在渲染时比较
    const [prevCurrentModel, setPrevCurrentModel] = useState(currentModel);
    if (currentModel !== prevCurrentModel) {
        setPrevCurrentModel(currentModel);
        setCustomModel(currentModel || '');
    }

    const fetchModels = async () => {
        if (!apiKey) {
            setError(t.modelSelector?.enterApiKeyFirst || "Please enter API Key first");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const data = await apiClient.post<ModelsResponse>("/api/ai/models", {
                provider,
                apiKey,
                ...(baseUrl && { baseUrl }),
            });

            // Check if there's an error message in the response
            if ('error' in data && typeof data.error === 'string') {
                setError(data.error);
                setUseCustom(true);
                setModels([]);
                return;
            }

            setModels(data.models);

            if (data.models.length === 0) {
                setError(t.modelSelector?.noVisionModel || "No vision model found, please enter manually");
                setUseCustom(true);
            }
        } catch (err) {
            frontendLogger.error('[ModelSelector]', 'Failed to fetch models', { error: err });
            const errorMsg = (err instanceof Error && err.message) || (t.modelSelector?.fetchFailed || "Failed to fetch models");
            setError(errorMsg + (t.modelSelector?.enterManually || ", please enter manually"));
            setUseCustom(true);
        } finally {
            setLoading(false);
        }
    };

    const handleModelSelect = (modelId: string) => {
        if (modelId === '_custom') {
            setUseCustom(true);
        } else {
            setUseCustom(false);
            setCustomModel(modelId);
            onModelChange(modelId);
        }
    };

    const handleCustomModelChange = (value: string) => {
        setCustomModel(value);
        onModelChange(value);
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <Label className="flex-1">{t.modelSelector?.modelName || 'Model Name'}</Label>
                {docsHref && (
                    <a href={docsHref} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline">
                        {t.settings.ai.docLinks.models}
                        <ExternalLink className="h-3 w-3" />
                    </a>
                )}
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={fetchModels}
                    disabled={loading || !apiKey}
                >
                    {loading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                        <RefreshCw className="h-3 w-3" />
                    )}
                </Button>
            </div>

            {error && (
                <p className="text-xs text-yellow-600">{error}</p>
            )}

            {useCustom || models.length === 0 ? (
                <div className="space-y-2">
                    <Input
                        value={customModel}
                        onChange={(e) => handleCustomModelChange(e.target.value)}
                        placeholder={isVendorProvider(provider) ? VENDOR_PRESETS[provider].model : provider === 'openai' ? "gpt-6.1-sol" : "gemini-1.5-flash"}
                    />
                    {models.length > 0 && (
                        <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs"
                            onClick={() => setUseCustom(false)}
                        >
                            {t.modelSelector?.selectFromList || 'Select from List'}
                        </Button>
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    <Select
                        value={currentModel}
                        onValueChange={handleModelSelect}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder={t.modelSelector?.selectModel || 'Select Model'} />
                        </SelectTrigger>
                        <SelectContent>
                            {models.map((model) => (
                                <SelectItem key={model.id} value={model.id}>
                                    {model.name}
                                    {model.owned_by && ` (${model.owned_by})`}
                                </SelectItem>
                            ))}
                            <SelectItem value="_custom">{t.modelSelector?.customInput || 'Custom Input...'}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            )}
        </div>
    );
}
