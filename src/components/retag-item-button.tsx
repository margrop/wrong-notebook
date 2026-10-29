"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { toast } from "@/lib/feedback";

type RetagItemButtonProps = {
    errorItemId: string;
} & (
    /** 直接保存：重新生成成功后回调，用于刷新题目 */
    | { onDone: () => void; onSuggested?: never }
    /** 预览：只把 AI 建议的知识点交给调用方（如填入编辑框），不保存 */
    | { onSuggested: (tags: string[]) => void; onDone?: never }
);

/** 单题用 AI 重新生成知识点 */
export function RetagItemButton({ errorItemId, onDone, onSuggested }: RetagItemButtonProps) {
    const { t } = useLanguage();
    const [running, setRunning] = useState(false);

    const handleClick = async () => {
        setRunning(true);
        try {
            if (onSuggested) {
                const result = await apiClient.post<{ tags: string[] }>(`/api/error-items/${errorItemId}/retag`, { preview: true }, { recoverable: true });
                onSuggested(result.tags);
            } else {
                await apiClient.post(`/api/error-items/${errorItemId}/retag`, {}, { recoverable: true });
                onDone?.();
            }
        } catch (error) {
            const code = (error as { data?: { message?: string } })?.data?.message || "";
            const mapped = (t.errors as Record<string, unknown>)[code];
            frontendLogger.error('[RetagItem]', 'Failed to regenerate tags', { code });
            toast.error(code === "NO_TAGS_SELECTED" ? t.retag.noTags : typeof mapped === "string" ? mapped : t.retag.itemFailed);
        } finally {
            setRunning(false);
        }
    };

    return (
        <Button variant="ghost" size="sm" onClick={handleClick} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            {onSuggested
                ? (running ? t.retag.suggestRunning : t.retag.suggestButton)
                : (running ? t.retag.itemRunning : t.retag.itemButton)}
        </Button>
    );
}
