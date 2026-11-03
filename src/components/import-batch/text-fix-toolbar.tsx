"use client";

import { CheckCheck, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

interface TextFixToolbarProps {
    /** 已选、有文字且没有待确认建议的题数 */
    targetCount: number;
    /** 有待确认修正建议的题数 */
    pendingCount: number;
    fixing: boolean;
    onFix: () => void;
    onAcceptAll: () => void;
}

/** 文字批次预览顶部的「AI 修正文字」入口：批量修正已选的题，并可一次接受全部建议 */
export function TextFixToolbar({ targetCount, pendingCount, fixing, onFix, onAcceptAll }: TextFixToolbarProps) {
    const { t } = useLanguage();
    return (
        <div className="space-y-1 rounded-lg border border-dashed p-3" data-testid="text-fix-toolbar">
            <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={onFix} disabled={fixing || targetCount === 0}>
                    {fixing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
                    {fixing ? t.importBatch.fixText.running : t.importBatch.fixText.selected.replace("{count}", String(targetCount))}
                </Button>
                {pendingCount > 0 && (
                    <Button type="button" size="sm" onClick={onAcceptAll}>
                        <CheckCheck className="mr-1 h-4 w-4" />{t.importBatch.fixText.acceptAll.replace("{count}", String(pendingCount))}
                    </Button>
                )}
            </div>
            <p className="text-xs text-muted-foreground">{t.importBatch.fixText.hint}</p>
        </div>
    );
}
