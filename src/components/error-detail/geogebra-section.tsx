"use client";

import { useState } from "react";
import { Box, Loader2 } from "lucide-react";
import { GeogebraDemo } from "@/components/geogebra-demo";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { getApiErrorMessage, getErrorMessage } from "@/lib/error-message";
import { frontendLogger } from "@/lib/frontend-logger";
import type { UpdateErrorItem } from "./types";

interface GeogebraSectionProps {
    errorItemId: string;
    commands?: string | null;
    onUpdate: UpdateErrorItem;
}

/** GeoGebra 动态演示：已有命令时显示演示，否则提供由 AI 生成的入口 */
export function GeogebraSection({ errorItemId, commands, onUpdate }: GeogebraSectionProps) {
    const { t } = useLanguage();
    const [analyzing, setAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleAnalyze = async () => {
        setAnalyzing(true);
        setError(null);
        try {
            const result = await apiClient.post<{ suitable: boolean; commands: string[]; description: string }>(`/api/error-items/${errorItemId}/geogebra`, {}, { recoverable: true });
            if (result.suitable && result.commands.length > 0) {
                onUpdate({ geogebraCommands: JSON.stringify(result.commands) });
            } else {
                setError(result.description || t.geogebra.notSuitable);
            }
        } catch (err) {
            frontendLogger.error('[ErrorDetail]', 'GeoGebra analysis failed', { error: err });
            const msg = getApiErrorMessage(err) || getErrorMessage(err);
            if (msg.includes("AI_AUTH_ERROR")) {
                setError(t.geogebra.authFailed);
            } else if (msg.includes("AI_CONNECTION")) {
                setError(t.geogebra.connectionFailed);
            } else {
                setError(t.geogebra.analyzeFailed);
            }
        } finally {
            setAnalyzing(false);
        }
    };

    const handleSaveCommands = async (next: string) => {
        await apiClient.put(`/api/error-items/${errorItemId}`, { geogebraCommands: next });
        onUpdate({ geogebraCommands: next });
    };

    // 失败时抛出，由 GeogebraDemo 提示
    const handleDelete = async () => {
        await apiClient.delete(`/api/error-items/${errorItemId}/geogebra`);
        onUpdate({ geogebraCommands: null });
    };

    if (commands) {
        return <GeogebraDemo commands={commands} height={700} showToolBar={true} showAlgebraInput={false} showMenuBar={false} onRegenerate={handleAnalyze} onSaveCommands={handleSaveCommands} onDelete={handleDelete} />;
    }

    return (
        <div className="rounded-lg border border-dashed p-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Box className="h-4 w-4" /><span>{t.geogebra.title}</span></div>
                <Button variant="outline" size="sm" onClick={handleAnalyze} disabled={analyzing}>
                    {analyzing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t.geogebra.analyzing}</> : <><Box className="mr-2 h-4 w-4" />{t.geogebra.generate}</>}
                </Button>
            </div>
            {error && <p className="text-xs text-muted-foreground mt-2">{error}</p>}
            <p className="text-xs text-muted-foreground mt-2">{t.geogebra.hint}</p>
        </div>
    );
}
