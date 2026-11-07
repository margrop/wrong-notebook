"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, Loader2, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProviderErrorDetail } from "@/components/settings/provider-error-detail";
import { useLanguage } from "@/contexts/LanguageContext";
import { buildProviderTestRequest, routedProviders } from "@/lib/ai/connection-test";
import { aiProviderName } from "@/lib/ai/routing";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/error-message";
import { frontendLogger } from "@/lib/frontend-logger";
import type { AiProviderId } from "@/lib/config/types";
import type { AppConfig } from "@/types/api";

interface TestResult {
    success: boolean;
    textSupport: boolean;
    visionSupport: boolean;
    textError?: string;
    visionError?: string;
    /** 服务商的原始报错 */
    textErrorDetail?: string;
    visionErrorDetail?: string;
    modelInfo?: string;
}

interface AiConnectionTestProps {
    config: AppConfig;
    /** 保存中时禁用测试 */
    saving: boolean;
    /** 与测试按钮并排显示的保存按钮 */
    saveButton: ReactNode;
}

/** 一个渠道的测试结果 */
interface ChannelResult {
    provider: AiProviderId;
    result: TestResult;
}

/** 测试当前 AI 渠道的文本与图像识别能力，并显示结果；设置了渠道分工时逐个测试用到的渠道 */
export function AiConnectionTest({ config, saving, saveButton }: AiConnectionTestProps) {
    const { t, language } = useLanguage();
    const [testing, setTesting] = useState(false);
    const [results, setResults] = useState<ChannelResult[] | null>(null);
    const errorText = (code: string) => (t.settings?.ai?.errors as Record<string, string>)?.[code] || code.replace('UNKNOWN:', '');

    /** 测试一个渠道；缺少必填项时直接返回失败结果 */
    const testProvider = async (provider: AiProviderId): Promise<TestResult> => {
        const request = buildProviderTestRequest(config, provider, language);
        if (!request.ok) {
            if (request.error === 'UNSUPPORTED_PROVIDER') return { success: false, textSupport: false, visionSupport: false, textError: request.error };
            const textError = request.error === 'AZURE_CONFIG_INCOMPLETE'
                ? (t.settings?.ai?.validationAzureEndpointRequired || 'Azure config is incomplete')
                : (t.settings?.ai?.validationApiKeyRequired || 'API Key is required');
            return { success: false, textSupport: false, visionSupport: false, textError };
        }
        try {
            return await apiClient.post<TestResult>('/api/ai/test', request.body);
        } catch (error) {
            frontendLogger.error('[AiConnectionTest]', 'AI connection test failed', { error, provider });
            return { success: false, textSupport: false, visionSupport: false, textError: getErrorMessage(error) };
        }
    };

    const handleTest = async () => {
        setTesting(true);
        setResults(null);
        try {
            // 逐个测试，避免同时触发多个服务商的并发限制
            const tested: ChannelResult[] = [];
            for (const provider of routedProviders(config)) {
                tested.push({ provider, result: await testProvider(provider) });
                setResults([...tested]);
            }
        } finally {
            setTesting(false);
        }
    };

    const allPassed = results !== null && results.every(({ result }) => result.success);
    const multiple = (results?.length ?? 0) > 1;

    return (
        <div className="space-y-3 pt-3 border-t">
            <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={handleTest} disabled={testing || saving} className="flex-1">
                    {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
                    {testing ? (t.settings?.ai?.testing || "Testing...") : (t.settings?.ai?.testConnection || "Test Connection")}
                </Button>
                {saveButton}
            </div>

            {results && (
                <div className="space-y-2">
                    <div className={`flex items-center gap-2 text-sm font-medium ${allPassed ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                        {allPassed ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                        {allPassed
                            ? (t.settings?.ai?.testSuccess || "Connection Successful")
                            : (t.settings?.ai?.testFailed || "Connection Failed")}
                    </div>
                    {results.map(({ provider, result }) => (
                        <div key={provider} className={`p-3 rounded-md text-sm ${result.success ? 'bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900' : 'bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900'}`}>
                            {multiple && (
                                <div className="flex items-center gap-2 text-xs font-medium mb-1">
                                    {result.success ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <XCircle className="h-3.5 w-3.5 text-red-600" />}
                                    {aiProviderName(provider, language)}
                                    {result.modelInfo && <span className="text-muted-foreground">({result.modelInfo})</span>}
                                </div>
                            )}
                            {result.success && (
                                <div className="space-y-1 text-xs">
                                    <div className="flex items-center gap-2">
                                        <span className="text-muted-foreground">{t.settings?.ai?.textSupport || "Text Generation"}:</span>
                                        <span className="text-green-600">✓ {t.settings?.ai?.supported || "Supported"}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-muted-foreground">{t.settings?.ai?.visionSupport || "Vision/Multimodal"}:</span>
                                        {result.visionSupport ? (
                                            <span className="text-green-600">✓ {t.settings?.ai?.supported || "Supported"}</span>
                                        ) : (
                                            <span className="text-amber-600">✗ {result.visionError ? errorText(result.visionError) : (t.settings?.ai?.notSupported || "Not Supported")}</span>
                                        )}
                                    </div>
                                    {!result.visionSupport && <ProviderErrorDetail detail={result.visionErrorDetail} />}
                                </div>
                            )}
                            {!result.success && result.textError && (
                                <p className="text-red-600 text-xs mt-1">{errorText(result.textError)}</p>
                            )}
                            {!result.success && <ProviderErrorDetail detail={result.textErrorDetail} />}
                        </div>
                    ))}
                    <p className="text-muted-foreground/60 text-[10px] pl-1">{t.settings?.ai?.testNetworkNote}</p>
                </div>
            )}
        </div>
    );
}