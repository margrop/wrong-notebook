"use client";

import { useState } from "react";
import { Box, Loader2 } from "lucide-react";
import { GeogebraDemo } from "@/components/geogebra-demo";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import type { CorrectionDraft, UpdateDraft } from "./types";

interface GeogebraDraftProps {
    data: CorrectionDraft;
    onChange: UpdateDraft;
}

/** 校对页的 GeoGebra 演示：题目和答案都填写后才可生成，生成结果随题目一起保存 */
export function GeogebraDraft({ data, onChange }: GeogebraDraftProps) {
    const { t } = useLanguage();
    const [analyzing, setAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleAnalyze = async () => {
        if (!data.questionText.trim()) {
            toast.warning(t.editor.enterQuestionFirst || "Please enter question text first");
            return;
        }
        if (!data.answerText.trim()) {
            toast.warning(t.geogebra.answerRequired);
            return;
        }

        setAnalyzing(true);
        setError(null);
        try {
            const result = await apiClient.post<{ suitable?: boolean; commands?: string[]; description?: string }>(
                "/api/geogebra-analyze",
                { questionText: data.questionText, answerText: data.answerText, analysis: data.analysis },
                // 原先直接用 fetch，没有超时限制；AI 分析可能较慢
                { timeout: 180000, recoverable: true },
            );
            if (result.suitable && result.commands && result.commands.length > 0) {
                onChange({ geogebraCommands: JSON.stringify(result.commands) });
            } else {
                setError(result.description || t.geogebra.notSuitable);
            }
        } catch (err) {
            frontendLogger.error('[CorrectionEditor]', 'GeoGebra analysis failed', { error: err });
            setError(t.geogebra.analyzeFailed);
        } finally {
            setAnalyzing(false);
        }
    };

    if (data.geogebraCommands) {
        return <GeogebraDemo commands={data.geogebraCommands} height={350} onRegenerate={handleAnalyze} onDelete={async () => onChange({ geogebraCommands: undefined })} />;
    }
    if (!data.questionText.trim() || !data.answerText.trim()) return null;

    return (
        <div className="rounded-lg border border-dashed p-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Box className="h-4 w-4" />
                    <span>{t.geogebra.title}</span>
                </div>
                <Button variant="outline" size="sm" onClick={handleAnalyze} disabled={analyzing}>
                    {analyzing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t.geogebra.analyzing}</> : <><Box className="mr-2 h-4 w-4" />{t.geogebra.generate}</>}
                </Button>
            </div>
            {error && <p className="text-xs text-muted-foreground mt-2">{error}</p>}
            <p className="text-xs text-muted-foreground mt-2">{t.geogebra.hint}</p>
        </div>
    );
}
