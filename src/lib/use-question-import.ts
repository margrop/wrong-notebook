"use client";

import { useEffect, useState } from "react";
import type { ProgressStatus } from "@/components/ui/progress-feedback";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ParsedQuestion } from "@/lib/ai";
import { getAnalysisErrorMessage } from "@/lib/analysis-error";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/error-message";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { confirmImportTask, createImportTask, markImportTaskRead } from "@/lib/import-task-client";
import { processImageFile } from "@/lib/image-utils";
import { normalizeMistakeStatus } from "@/lib/mistake-status";
import { fetchConfirmBeforeImport, saveParsedQuestion } from "@/lib/question-import";
import type { ImportedQuestion } from "@/lib/question-import";
import type { ImportTaskDetail } from "@/lib/import-task-types";
import { useImportTask } from "@/lib/use-import-tasks";
import { useQuestionSaver } from "@/lib/use-question-saver";
import type { AppConfig } from "@/types/api";

/** 未配置时 AI 识别的超时（毫秒） */
const DEFAULT_AI_TIMEOUT = 180000;

export type ReviewedQuestion = ParsedQuestion & { subjectId?: string; paperLevel?: string };

interface ReanswerResponse {
    gradeSemester?: string | null;
    answerText: string;
    analysis: string;
    knowledgePoints: string[];
    wrongAnswerText: string;
    mistakeAnalysis: string;
    mistakeStatus: string;
    difficultyStars?: number | null;
    subject?: string;
}

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
    /** 图片识别完成、进入校对页之前调用（如按学科自动选择错题本） */
    onParsed?: (data: ParsedQuestion) => void;
}

/**
 * 题目导入流程：裁剪图片 → 压缩 → 上传并创建服务端识别任务 → 免确认时服务端直接入库，否则进入校对页后确认入库。
 * 上传完成后不再遮挡页面：识别在服务端继续，可离开页面，结果在「识别任务」中取回。
 * 文字解题仍在请求内完成。首页与错题本的添加错题页共用。
 */
export function useQuestionImport({ logPrefix, analyzeSubjectId, importSubjectId, textNotebook, fixedSubjectId, onParsed }: QuestionImportOptions) {
    const { t, language } = useLanguage();
    const saver = useQuestionSaver(logPrefix);
    const [step, setStep] = useState<"upload" | "review">("upload");
    const [analysisStep, setAnalysisStep] = useState<ProgressStatus>('idle');
    const [parsedData, setParsedData] = useState<ParsedQuestion | null>(null);
    const [currentImage, setCurrentImage] = useState<string | null>(null);
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [croppingImage, setCroppingImage] = useState<string | null>(null);
    const [isCropperOpen, setIsCropperOpen] = useState(false);
    // 免确认导入：偏好、最近一次导入结果、批量框选的题目图片
    const [confirmBeforeImport, setConfirmBeforeImport] = useState(false);
    const [lastImported, setLastImported] = useState<ImportedQuestion | null>(null);
    const [batchBlobs, setBatchBlobs] = useState<Blob[] | null>(null);
    // 本页发起、尚未处理的识别任务；校对页对应的任务
    const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
    const [reviewTaskId, setReviewTaskId] = useState<string | null>(null);
    // 本页发起的任务有结果时：待校对直接进入校对页，已保存显示结果条；失败保留在状态卡中供重试
    const handlePendingUpdate = (task: ImportTaskDetail) => {
        if (task.status === 'review' && task.result) {
            onParsed?.(task.result);
            setParsedData(task.result);
            setCurrentImage(task.imageData);
            setReviewTaskId(task.id);
            setStep("review");
            setPendingTaskId(null);
            markImportTaskRead(task.id).catch(() => undefined);
        } else if (task.status === 'saved' && task.errorItemId) {
            setLastImported({
                id: task.errorItemId,
                shortId: task.errorItemShortId,
                subjectId: null,
                notebookName: task.notebookName,
                duplicate: task.duplicate,
            });
            setPendingTaskId(null);
            markImportTaskRead(task.id).catch(() => undefined);
            frontendLogger.info(logPrefix, 'Imported without review', { id: task.errorItemId, timings: task.timings });
        }
    };
    const pending = useImportTask(pendingTaskId, handlePendingUpdate);

    const aiTimeout = config?.timeouts?.analyze || DEFAULT_AI_TIMEOUT;
    const safetyTimeout = aiTimeout + 10000;

    // Cleanup Blob URL to prevent memory leak
    useEffect(() => {
        return () => {
            if (croppingImage) URL.revokeObjectURL(croppingImage);
        };
    }, [croppingImage]);

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

    const selectImage = (file: File) => {
        setLastImported(null);
        saver.setSaveError(null);
        setCroppingImage(URL.createObjectURL(file));
        setIsCropperOpen(true);
    };

    const startBatch = (blobs: Blob[]) => {
        setIsCropperOpen(false);
        setLastImported(null);
        saver.setSaveError(null);
        setBatchBlobs(blobs);
    };

    /** 文字解题结果：未开启人工确认时直接入库，否则进入校对页 */
    const handleTextParsed = async (data: ParsedQuestion) => {
        if (!confirmBeforeImport) {
            setAnalysisStep('saving');
            const imported = await saveParsedQuestion(data, { subjectId: importSubjectId, imageUrl: null });
            setLastImported(imported);
            setCurrentImage(null);
            frontendLogger.info(logPrefix, 'Imported without review', { id: imported.id });
            return;
        }
        setReviewTaskId(null);
        setCurrentImage(null);
        setParsedData(data);
        setStep("review");
    };

    /** 压缩并上传图片，创建服务端识别任务；上传完成即关闭遮罩 */
    const analyzeImage = async (file: File) => {
        const startTime = Date.now();
        frontendLogger.info(logPrefix, 'Starting import task', { sourceType: file.type, sourceBytes: file.size });
        try {
            setAnalysisStep('compressing');
            const compressStarted = Date.now();
            const base64Image = await processImageFile(file);
            const compressMs = Date.now() - compressStarted;

            setAnalysisStep('uploading');
            const uploadStarted = Date.now();
            const task = await createImportTask({
                imageBase64: base64Image,
                language,
                subjectId: analyzeSubjectId,
                // 添加页固定错题本；首页指定了错题本时免确认入库放入该错题本，校对时由用户选择
                targetSubjectId: fixedSubjectId ?? (confirmBeforeImport ? null : importSubjectId),
                clientTimings: { compress: compressMs },
                imageInfo: { sourceType: file.type || undefined, sourceBytes: file.size, outputBytes: Math.round(base64Image.length * 3 / 4) },
            });
            frontendLogger.info(logPrefix, 'Import task created', { taskId: task.id, compressMs, uploadMs: Date.now() - uploadStarted, totalMs: Date.now() - startTime });
            setPendingTaskId(task.id);
            pending.setTask(task);
        } catch (error) {
            frontendLogger.error(logPrefix, 'Upload failed', { errorDuration: Date.now() - startTime, error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            setAnalysisStep('idle');
        }
    };

    const cropComplete = (croppedBlob: Blob) => {
        setIsCropperOpen(false);
        analyzeImage(new File([croppedBlob], "cropped-image.jpg", { type: "image/jpeg" }));
    };

    /** 文字题目由 AI 解答后导入 */
    const submitText = async (questionText: string) => {
        saver.setSaveError(null);
        const startTime = Date.now();
        frontendLogger.info(logPrefix, 'Starting text-based analysis', { textLength: questionText.length });
        try {
            setAnalysisStep('analyzing');
            const result = await apiClient.post<ReanswerResponse>("/api/reanswer", {
                questionText,
                language,
                forImport: true,
                subject: textNotebook?.name,
                subjectId: textNotebook?.id,
            }, { timeout: aiTimeout, recoverable: true });

            setAnalysisStep('processing');
            await handleTextParsed({
                questionText,
                answerText: result.answerText,
                analysis: result.analysis,
                knowledgePoints: result.knowledgePoints || [],
                wrongAnswerText: result.wrongAnswerText || "",
                mistakeAnalysis: result.mistakeAnalysis || "",
                mistakeStatus: normalizeMistakeStatus(result.mistakeStatus),
                subject: (result.subject || "其他") as ParsedQuestion["subject"],
                requiresImage: false,
                difficultyStars: result.difficultyStars ?? null,
                gradeSemester: result.gradeSemester ?? null,
            });
            frontendLogger.info(logPrefix, 'Text analysis completed', { totalDuration: Date.now() - startTime });
        } catch (error) {
            frontendLogger.error(logPrefix, 'Text analysis failed', { errorDuration: Date.now() - startTime, error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            setAnalysisStep('idle');
        }
    };

    /** 保存题目；重复题跳到原题，否则跳到所在错题本 */
    const saveQuestion = (payload: Record<string, unknown> & { subjectId?: string | null }) =>
        saver.run(() => apiClient.post<{ id: string; duplicate?: boolean }>("/api/error-items", payload), payload.subjectId);

    /** 校对页保存：图片识别的结果通过任务确认入库（同一任务只会入库一次），文字解题直接保存 */
    const saveReviewed = async (finalData: ReviewedQuestion) => {
        const subjectId = fixedSubjectId ?? finalData.subjectId;
        const taskId = reviewTaskId;
        const saved = taskId
            ? await saver.run(() => confirmImportTask(taskId, { ...finalData, subjectId }), subjectId)
            : await saveQuestion({ ...finalData, originalImageUrl: currentImage || "", ...(fixedSubjectId ? { subjectId: fixedSubjectId } : {}) });
        if (saved) {
            setStep("upload");
            setParsedData(null);
            setCurrentImage(null);
            setReviewTaskId(null);
        }
    };

    return {
        step, cancelReview: () => { setStep("upload"); saver.setSaveError(null); },
        saveError: saver.saveError, dismissSaveError: saver.dismissSaveError,
        analysisStep, setAnalysisStep, isBusy: analysisStep !== 'idle',
        parsedData, currentImage, aiTimeout,
        croppingImage, isCropperOpen, closeCropper: () => setIsCropperOpen(false),
        lastImported, dismissImported: () => setLastImported(null),
        batchBlobs, closeBatch: () => setBatchBlobs(null),
        pendingTask: pendingTaskId ? pending.task : null,
        refreshPendingTask: pending.refresh,
        dismissPendingTask: () => setPendingTaskId(null),
        selectImage, cropComplete, startBatch, submitText, saveQuestion, saveReviewed,
    };
}
