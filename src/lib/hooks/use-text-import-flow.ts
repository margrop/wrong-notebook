"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ParsedQuestion } from "@/lib/ai";
import { getAnalysisErrorMessage } from "@/lib/question/analysis-error";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/error-message";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { createImportBatch } from "@/lib/import/import-batch-client";
import { createStructuredImportBatches, needsAutoSplit, splitLongTextToStructuredItems } from "@/lib/import/structured-batches";
import { MAX_SPLIT_QUESTIONS, splitQuestionText } from "@/lib/question-split/text";
import { saveParsedQuestion } from "@/lib/import/question-import";
import type { ImportedQuestion } from "@/lib/import/question-import";
import {
    buildTextBatchParams,
    buildTextReanswerBody,
    parseReanswerResponse,
} from "@/lib/import/question-import-flow";
import type { ReanswerResponse } from "@/lib/import/question-import-flow";
import type { ProgressStatus } from "@/components/ui/progress-feedback";
import type { Translations } from "@/lib/translations";

export interface TextFlowDeps {
    logPrefix: string;
    t: Translations;
    language: "zh" | "en";
    analyzeSubjectId?: string | null;
    importSubjectId?: string | null;
    textNotebook?: { id: string; name: string };
    fixedSubjectId?: string;
    confirmBeforeImport: boolean;
    aiTimeout: number;
    setAnalysisStep: (step: ProgressStatus) => void;
    clearSaveError: () => void;
}

/**
 * 文字导入流程：文字解题 → 免确认直接入库 / 进入校对页；
 * 多题文字批次创建。管理校对步骤、解析结果与最近一次导入。
 */
export function useTextImportFlow(deps: TextFlowDeps) {
    const { logPrefix, t, language, analyzeSubjectId, importSubjectId, textNotebook, fixedSubjectId, confirmBeforeImport, aiTimeout } = deps;
    const router = useRouter();
    const [creatingBatch, setCreatingBatch] = useState(false);
    const [step, setStep] = useState<"upload" | "review">("upload");
    const [parsedData, setParsedData] = useState<ParsedQuestion | null>(null);
    const [currentImage, setCurrentImage] = useState<string | null>(null);
    const [lastImported, setLastImported] = useState<ImportedQuestion | null>(null);

    const targetCtx = { fixedSubjectId, confirmBeforeImport, importSubjectId };

    /** 文字解题结果：未开启人工确认时直接入库，否则进入校对页 */
    const handleTextParsed = async (data: ParsedQuestion) => {
        if (!confirmBeforeImport) {
            deps.setAnalysisStep('saving');
            const imported = await saveParsedQuestion(data, { subjectId: importSubjectId, imageUrl: null });
            setLastImported(imported);
            setCurrentImage(null);
            frontendLogger.info(logPrefix, 'Imported without review', { id: imported.id });
            return;
        }
        setCurrentImage(null);
        setParsedData(data);
        setStep("review");
    };

    /** 文字题目由 AI 解答后导入 */
    const submitText = async (questionText: string) => {
        deps.clearSaveError();
        const startTime = Date.now();
        frontendLogger.info(logPrefix, 'Starting text-based analysis', { textLength: questionText.length });
        try {
            deps.setAnalysisStep('analyzing');
            const result = await apiClient.post<ReanswerResponse>("/api/reanswer",
                buildTextReanswerBody({ questionText, language, textNotebook }),
                { timeout: aiTimeout, recoverable: true });

            deps.setAnalysisStep('processing');
            await handleTextParsed(parseReanswerResponse(result, questionText));
            frontendLogger.info(logPrefix, 'Text analysis completed', { totalDuration: Date.now() - startTime });
        } catch (error) {
            frontendLogger.error(logPrefix, 'Text analysis failed', { errorDuration: Date.now() - startTime, error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            deps.setAnalysisStep('idle');
        }
    };

    /**
     * 多题文字：创建批次（本地规则分题不调用 AI；splitter 为 ai 时由模型分题），进入分题预览。
     * 超出单批上限（60 题 / 20000 字）时自动拆成多个结构化批次
     */
    const createTextBatch = async (text: string, splitter: "local" | "ai", forceNumbered = false) => {
        deps.clearSaveError();
        setCreatingBatch(true);
        try {
            if (splitter === 'local') {
                const detection = splitQuestionText(text, { forceNumbered });
                if (needsAutoSplit(detection)) {
                    frontendLogger.info(logPrefix, 'Auto-splitting long text', { candidateCount: detection.candidateCount, overflow: detection.overflow, tooLong: detection.tooLong });
                    let structuredItems;
                    try {
                        structuredItems = splitLongTextToStructuredItems(text, { forceNumbered });
                    } catch (error) {
                        frontendLogger.error(logPrefix, 'Auto-split failed', { error: getErrorMessage(error) });
                        toast.error(getErrorMessage(error));
                        return;
                    }
                    const { batches, failures } = await createStructuredImportBatches(structuredItems, {
                        language,
                        subjectId: analyzeSubjectId ?? textNotebook?.id,
                        targetSubjectId: targetCtx.fixedSubjectId ?? (targetCtx.confirmBeforeImport ? null : targetCtx.importSubjectId ?? null),
                    });
                    frontendLogger.info(logPrefix, 'Auto-split batches created', { count: batches.length, failures: failures.length });
                    if (batches.length > 0) {
                        toast.success(t.app.autoSplitHint.replace('{count}', String(batches.length)).replace('{max}', String(MAX_SPLIT_QUESTIONS)));
                        router.push(`/import-batches/${batches[0].id}`);
                    }
                    for (const failure of failures) {
                        toast.error(t.app.autoSplitFailed.replace('{index}', String(failure.index + 1)).replace('{error}', getErrorMessage(failure.error)));
                    }
                    return;
                }
            }
            const batch = await createImportBatch(buildTextBatchParams(
                { text, splitter, forceNumbered, language, analyzeSubjectId, textNotebookId: textNotebook?.id },
                targetCtx,
            ));
            frontendLogger.info(logPrefix, 'Text batch created', { batchId: batch.id, splitter, questions: batch.itemCount });
            router.push(`/import-batches/${batch.id}`);
        } catch (error) {
            frontendLogger.error(logPrefix, 'Text batch failed', { error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            setCreatingBatch(false);
        }
    };

    const cancelReview = () => {
        setStep("upload");
        deps.clearSaveError();
    };

    const dismissImported = () => setLastImported(null);

    return {
        step, setStep, cancelReview,
        parsedData, setParsedData,
        currentImage, setCurrentImage,
        lastImported, dismissImported,
        creatingBatch,
        submitText, createTextBatch,
    };
}
