"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, Loader2, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProviderErrorDetail } from "@/components/settings/provider-error-detail";
import { useLanguage } from "@/contexts/LanguageContext";
import { buildConnectionTestRequest } from "@/lib/ai/connection-test";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/error-message";
import { frontendLogger } from "@/lib/frontend-logger";
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

/** 测试当前 AI 渠道的文本与图像识别能力，并显示结果 */
export function AiConnectionTest({ config, saving, saveButton }: AiConnectionTestProps) {
    const { t, language } = useLanguage();
    const [testing, setTesting] = useState(false);
    const [result, setResult] = useState<TestResult | null>(null);
    const errorText = (code: string) => (t.settings?.ai?.errors as Record<string, string>)?.[code] || code.replace('UNKNOWN:', '');

    const handleTest = async () => {
        const request = buildConnectionTestRequest(config, language);
        if (!request.ok) {
            if (request.error === 'UNSUPPORTED_PROVIDER') return;
            const textError = request.error === 'AZURE_CONFIG_INCOMPLETE'
                ? (t.settings?.ai?.validationAzureEndpointRequired || 'Azure config is incomplete')
                : (t.settings?.ai?.validationApiKeyRequired || 'API Key is required');
            setResult({ success: false, textSupport: false, visionSupport: false, textError });
            return;
        }

        setTesting(true);
        setResult(null);
        try {
            setResult(await apiClient.post<TestResult>('/api/ai/test', request.body));
        } catch (error) {
            frontendLogger.error('[AiConnectionTest]', 'AI connection test failed', { error });
            setResult({ success: false, textSupport: false, visionSupport: false, textError: getErrorMessage(error) });
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="space-y-3 pt-3 border-t">
            <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={handleTest} disabled={testing || saving} className="flex-1">
                    {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
                    {testing ? (t.settings?.ai?.testing || "Testing...") : (t.settings?.ai?.testConnection || "Test Connection")}
                </Button>
                {saveButton}
            </div>

            {result && (
                <div className={`p-3 rounded-md text-sm ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                    <div className="flex items-center gap-2 font-medium mb-2">
                        {result.success ? (
                            <>
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                <span className="text-green-700">{t.settings?.ai?.testSuccess || "Connection Successful"}</span>
                                {result.modelInfo && <span className="text-green-600 text-xs">({result.modelInfo})</span>}
                            </>
                        ) : (
                            <>
                                <XCircle className="h-4 w-4 text-red-600" />
                                <span className="text-red-700">{t.settings?.ai?.testFailed || "Connection Failed"}</span>
                            </>
                        )}
                    </div>
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
                            <p className="text-muted-foreground/60 text-[10px] pl-1">{t.settings?.ai?.testNetworkNote}</p>
                        </div>
                    )}
                    {!result.success && result.textError && (
                        <p className="text-red-600 text-xs mt-1">{errorText(result.textError)}</p>
                    )}
                    {!result.success && <ProviderErrorDetail detail={result.textErrorDetail} />}
                </div>
            )}
        </div>
    );
}
