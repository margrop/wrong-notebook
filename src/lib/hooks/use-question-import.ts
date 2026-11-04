"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { fetchConfirmBeforeImport } from "@/lib/import/question-import";
import type { ProgressStatus } from "@/components/ui/progress-feedback";
import { useLanguage } from "@/contexts/LanguageContext";
import { useImageImportFlow } from "@/lib/hooks/use-image-import-flow";
import { useTextImportFlow } from "@/lib/hooks/use-text-import-flow";
import { useImportTask } from "@/lib/hooks/use-import-tasks";
import { useQuestionSaver } from "@/lib/hooks/use-question-saver";
import type { BatchImage, ReviewedQuestion } from "@/lib/import/question-import-flow";
import type { AppConfig } from "@/types/api";

export type { BatchImage, ReviewedQuestion };
export { MAX_QUESTION_PARTS } from "@/lib/import/question-import-flow";

/** 未配置时 AI 识别的超时（毫秒） */
const DEFAULT_AI_TIMEOUT = 180000;

interface QuestionImportOptions {
    /** 日志前缀，如 [Home] */
    logPrefix: string;
    /** 识别时参考的错题本（决定候选知识点） */
    analyzeSubjectId?: string | null;
    /** 免确认直接入库时放入的错题本 */
    importSubjectId?: string | null;
    /** 文字解题时参考的错题本 */
    textNotebook?: { id: string; name: string };
    /** 校对后保存时固定放入的错题本，不传则使用校对页中选择的错题本 */
    fixedSubjectId?: string;
}

/**
 * 题目导入流程：裁剪图片 → 压缩 → 上传并创建服务端识别任务 → 免确认时服务端直接入库，否则在识别任务的校对页确认入库。
 * 上传完成后不再遮挡页面：识别在服务端继续，可离开页面，结果在状态卡和「识别任务」中取回。
 * 文字解题仍在请求内完成。首页与错题本的添加错题页共用。
 */
export function useQuestionImport({ logPrefix, analyzeSubjectId, importSubjectId, textNotebook, fixedSubjectId }: QuestionImportOptions) {
    const { t, language } = useLanguage();
    const saver = useQuestionSaver(logPrefix);
    const [analysisStep, setAnalysisStep] = useState<ProgressStatus>('idle');
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [confirmBeforeImport, setConfirmBeforeImport] = useState(false);
    // 本页最近发起的识别任务
    const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
    // 本页发起的任务只在状态卡中更新（含完成后的「继续校对」「查看错题」），不切换页面、不自动标记已读，
    // 用户正在录入下一题时不会被打断
    const pending = useImportTask(pendingTaskId);

    const aiTimeout = config?.timeouts?.analyze || DEFAULT_AI_TIMEOUT;
    const safetyTimeout = aiTimeout + 10000;

    const textFlow = useTextImportFlow({
        logPrefix, t, language, analyzeSubjectId, importSubjectId, textNotebook, fixedSubjectId,
        confirmBeforeImport, aiTimeout,
        setAnalysisStep, clearSaveError: () => saver.setSaveError(null),
    });

    const imageFlow = useImageImportFlow({
        logPrefix, t, language, analyzeSubjectId, fixedSubjectId,
        confirmBeforeImport, importSubjectId,
        setAnalysisStep,
        setPendingTaskId,
        setTask: pending.setTask,
        clearLastImported: textFlow.dismissImported,
        clearSaveError: () => saver.setSaveError(null),
    });

    useEffect(() => {
        fetchConfirmBeforeImport().then(setConfirmBeforeImport);
        apiClient.get<AppConfig>("/api/settings")
            .then(setConfig)
            .catch(err => frontendLogger.error(logPrefix, 'Failed to fetch config', { error: err }));
    }, [logPrefix]);

    // 保留按阶段计时的超时兜底，进度估值和已用时间由提示组件统一维护。
    useEffect(() => {
        if (analysisStep === 'idle') return;
        const timeout = setTimeout(() => {
            frontendLogger.warn('[Progress]', '处理超时，关闭进度提示', { analysisStep, safetyTimeout });
            setAnalysisStep('idle');
        }, safetyTimeout);
        return () => clearTimeout(timeout);
    }, [analysisStep, safetyTimeout]);

    /** 保存题目；重复题跳到原题，否则跳到所在错题本 */
    const saveQuestion = (payload: Record<string, unknown> & { subjectId?: string | null }) =>
        saver.run(() => apiClient.post<{ id: string; duplicate?: boolean }>("/api/error-items", payload), payload.subjectId);

    /** 文字解题的校对页保存（图片识别的结果在识别任务的校对页确认入库） */
    const saveReviewed = async (finalData: ReviewedQuestion) => {
        const saved = await saveQuestion({ ...finalData, originalImageUrl: textFlow.currentImage || "", ...(fixedSubjectId ? { subjectId: fixedSubjectId } : {}) });
        if (saved) {
            textFlow.setStep("upload");
            textFlow.setParsedData(null);
            textFlow.setCurrentImage(null);
        }
    };

    return {
        step: textFlow.step, cancelReview: textFlow.cancelReview,
        saveError: saver.saveError, dismissSaveError: saver.dismissSaveError,
        analysisStep, setAnalysisStep, isBusy: analysisStep !== 'idle',
        parsedData: textFlow.parsedData, currentImage: textFlow.currentImage, aiTimeout,
        croppingImage: imageFlow.croppingImage, isCropperOpen: imageFlow.isCropperOpen,
        closeCropper: imageFlow.closeCropper,
        lastImported: textFlow.lastImported, dismissImported: textFlow.dismissImported,
        batchImages: imageFlow.batchImages, closeBatch: imageFlow.closeBatch,
        completedStages: imageFlow.completedStages,
        pendingTask: pendingTaskId ? pending.task : null,
        refreshPendingTask: pending.refresh,
        dismissPendingTask: () => setPendingTaskId(null),
        selectImage: imageFlow.selectImage,
        cropRegions: imageFlow.cropRegions,
        submitText: textFlow.submitText,
        saveQuestion, saveReviewed,
        createTextBatch: textFlow.createTextBatch,
        autoSplitImage: imageFlow.autoSplitImage,
        creatingBatch: textFlow.creatingBatch,
        parts: imageFlow.parts,
        addPart: imageFlow.addPart,
        finishParts: imageFlow.finishParts,
        discardParts: imageFlow.discardParts,
    };
}
