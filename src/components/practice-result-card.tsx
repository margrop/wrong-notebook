"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PracticeResultPicker } from "@/components/practice-result-picker";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import type { PracticeResult } from "@/types/api";

interface PracticeResultCardProps {
    errorItemId: string;
    /** 根据用户答案自动判题得到的建议结果 */
    suggested: PracticeResult | null;
    question: { questionText: string; answerText: string; analysis: string; subject?: string; figureSvg?: string | null };
    difficulty: string;
}

/** 举一反三结束后由用户确认结果并保存 */
export function PracticeResultCard({ errorItemId, suggested, question, difficulty }: PracticeResultCardProps) {
    const { t } = useLanguage();
    const [result, setResult] = useState<PracticeResult | null>(suggested);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        if (!result) return;
        setSaving(true);
        setError(null);
        try {
            await apiClient.post("/api/practice/record", {
                errorItemId,
                result,
                difficulty,
                subject: question.subject || null,
                questionText: question.questionText,
                answerText: question.answerText,
                analysis: question.analysis,
                figureSvg: question.figureSvg ?? null,
            });
            setSaved(true);
        } catch (err) {
            frontendLogger.error('[Practice]', 'Failed to save practice result', {
                error: err instanceof Error ? err.message : String(err),
            });
            setError(t.mastery.resultSaveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className={saved ? "border-green-500" : "border-primary/40"}>
            <CardHeader>
                <CardTitle className="text-base">{t.mastery.markResult}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <PracticeResultPicker value={result} onChange={setResult} disabled={saved || saving} />
                {suggested && !saved && (
                    <p className="text-xs text-muted-foreground">{t.mastery.suggested}</p>
                )}
                {saved ? (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm text-green-700 dark:text-green-300">
                        <span className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4" />
                            {t.mastery.resultSaved}
                        </span>
                        <Link href={`/error-items/${errorItemId}`} className="text-primary hover:underline sm:ml-auto">
                            {t.mastery.viewQuestion}
                        </Link>
                    </div>
                ) : (
                    <Button onClick={handleSave} disabled={!result || saving} className="w-full sm:w-auto">
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        {t.mastery.saveResult}
                    </Button>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
        </Card>
    );
}
