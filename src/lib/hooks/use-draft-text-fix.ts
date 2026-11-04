"use client";

import { useCallback, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { getAnalysisErrorMessage } from "@/lib/question/analysis-error";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { fixImportBatchText } from "@/lib/import/import-batch-client";
import type { BatchDraft } from "@/lib/question-split/draft";
import { applyTextFixes } from "@/lib/question-split/draft-ops";

/**
 * 分题预览中的「AI 修正文字」：把若干题的当前文字交给服务端修正，返回的建议作为一次可撤销的编辑写入草稿。
 * 修正期间仍可编辑；建议只写入文字没再改动过的题。
 */
export function useDraftTextFix(batchId: string, draft: BatchDraft, onEdit: (change: (draft: BatchDraft) => BatchDraft) => void) {
    const { t } = useLanguage();
    const [fixingKeys, setFixingKeys] = useState<string[]>([]);

    const fix = useCallback(async (keys: string[]) => {
        const items = draft.items.filter((item) => keys.includes(item.key) && item.text.trim()).map((item) => ({ key: item.key, text: item.text }));
        if (items.length === 0) return;
        setFixingKeys(items.map((item) => item.key));
        try {
            const result = await fixImportBatchText(batchId, items);
            if (result.fixes.length > 0) onEdit((current) => applyTextFixes(current, result.fixes));
            const messages = [
                result.fixes.length > 0 ? t.importBatch.fixText.done.replace("{count}", String(result.fixes.length)) : null,
                result.unchanged.length > 0 ? t.importBatch.fixText.unchanged.replace("{count}", String(result.unchanged.length)) : null,
                result.failed.length > 0 ? t.importBatch.fixText.failed.replace("{count}", String(result.failed.length)) : null,
            ].filter(Boolean).join(" ");
            if (result.failed.length > 0) toast.warning(messages);
            else toast.success(messages);
        } catch (error) {
            frontendLogger.error("[ImportBatch]", "Text fix failed", { error });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            setFixingKeys([]);
        }
    }, [batchId, draft, onEdit, t]);

    return { fix, fixingKeys, fixing: fixingKeys.length > 0 };
}
