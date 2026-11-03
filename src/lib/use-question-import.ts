"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompletedStage, ProgressStatus } from "@/components/ui/progress-feedback";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ParsedQuestion } from "@/lib/ai";
import { getAnalysisErrorMessage } from "@/lib/analysis-error";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/error-message";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { createImportBatch } from "@/lib/import-batch-client";
import { createImportTask } from "@/lib/import-task-client";
import type { ImageRegion } from "@/lib/image-crop";
import { describeImage, ImageDecodeError, prepareImage, renderRegion } from "@/lib/image-pipeline";
import type { PreparedImage, RenderedImage } from "@/lib/image-pipeline";
import type { ImportImageInfo } from "@/lib/import-task-types";
import { normalizeMistakeStatus } from "@/lib/mistake-status";
import { fetchConfirmBeforeImport, saveParsedQuestion } from "@/lib/question-import";
import type { ImportedQuestion } from "@/lib/question-import";
import { useImportTask } from "@/lib/use-import-tasks";
import { useQuestionSaver } from "@/lib/use-question-saver";
import type { AppConfig } from "@/types/api";

/** 未配置时 AI 识别的超时（毫秒） */
const DEFAULT_AI_TIMEOUT = 180000;

export type ReviewedQuestion = ParsedQuestion & { subjectId?: string; paperLevel?: string };

/** 框选批量导入的一道题：已从原图裁剪并压缩好的图片 */
export interface BatchImage {
    dataUrl: string;
    info: ImportImageInfo;
    timings: { read: number; convert: number; crop: number; compress: number };
}

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
}

/**
 * 题目导入流程：裁剪图片 → 压缩 → 上传并创建服务端识别任务 → 免确认时服务端直接入库，否则在识别任务的校对页确认入库。
 * 上传完成后不再遮挡页面：识别在服务端继续，可离开页面，结果在状态卡和「识别任务」中取回。
 * 文字解题仍在请求内完成。首页与错题本的添加错题页共用。
 */
export function useQuestionImport({ logPrefix, analyzeSubjectId, importSubjectId, textNotebook, fixedSubjectId }: QuestionImportOptions) {
    const { t, language } = useLanguage();
    const router = useRouter();
    const saver = useQuestionSaver(logPrefix);
    const [creatingBatch, setCreatingBatch] = useState(false);
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
    const [batchImages, setBatchImages] = useState<BatchImage[] | null>(null);
    // 当前选择的照片（已解码、已按方向校正的原图），裁剪时从原图取区域
    const preparedRef = useRef<PreparedImage | null>(null);
    const [completedStages, setCompletedStages] = useState<CompletedStage[]>([]);
    // 本页最近发起的识别任务
    const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
    // 本页发起的任务只在状态卡中更新（含完成后的「继续校对」「查看错题」），不切换页面、不自动标记已读，
    // 用户正在录入下一题时不会被打断
    const pending = useImportTask(pendingTaskId);

    const aiTimeout = config?.timeouts?.analyze || DEFAULT_AI_TIMEOUT;
    const safetyTimeout = aiTimeout + 10000;

    // 离开页面时释放解码后的原图与预览图
    useEffect(() => () => preparedRef.current?.dispose(), []);

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

    const decodeErrorMessage = (error: ImageDecodeError) =>
        t.upload.decodeErrors[error.code].replace("{format}", error.format.toUpperCase());

    /** 选择照片：读取并解码（HEIC/HEIF 在此转换为 JPEG 并校正方向），生成缩略图后打开裁剪 */
    const selectImage = async (file: File) => {
        setLastImported(null);
        saver.setSaveError(null);
        setCompletedStages([]);
        setAnalysisStep('reading');
        try {
            const prepared = await prepareImage(file, () => setAnalysisStep('converting'));
            preparedRef.current?.dispose();
            preparedRef.current = prepared;
            frontendLogger.info(logPrefix, 'Image decoded', {
                format: prepared.format, sourceType: prepared.sourceType, sourceBytes: prepared.sourceBytes,
                width: prepared.width, height: prepared.height, decoder: prepared.decoder, ...prepared.timings,
            });
            setCroppingImage(prepared.previewUrl);
            setIsCropperOpen(true);
        } catch (error) {
            const message = error instanceof ImageDecodeError ? decodeErrorMessage(error) : getErrorMessage(error);
            frontendLogger.warn(logPrefix, 'Image decode failed', {
                code: error instanceof ImageDecodeError ? error.code : 'UNKNOWN',
                format: error instanceof ImageDecodeError ? error.format : 'unknown',
                sourceType: file.type, sourceBytes: file.size,
            });
            toast.error(message);
        } finally {
            setAnalysisStep('idle');
        }
    };

    const stageList = (timings: Partial<BatchImage["timings"]>): CompletedStage[] => [
        { label: t.upload.stages.read, ms: timings.read ?? 0 },
        ...(timings.convert !== undefined ? [{ label: t.upload.stages.convert, ms: timings.convert }] : []),
        ...(timings.compress !== undefined ? [{ label: t.upload.stages.compress, ms: (timings.crop ?? 0) + timings.compress }] : []),
    ];

    /** 从原图裁剪框选区域并压缩，返回各区域的图片与耗时 */
    const renderRegions = async (prepared: PreparedImage, regions: ImageRegion[]): Promise<BatchImage[]> => {
        const images: BatchImage[] = [];
        for (const region of regions) {
            const rendered: RenderedImage = await renderRegion(prepared, region);
            images.push({ dataUrl: rendered.dataUrl, info: describeImage(prepared, rendered), timings: { ...prepared.timings, ...rendered.timings } });
        }
        return images;
    };

    /** 裁剪完成：单题直接上传，多题进入批量导入 */
    const cropRegions = async (regions: ImageRegion[], multi: boolean) => {
        const prepared = preparedRef.current;
        if (!prepared || regions.length === 0) return;
        setIsCropperOpen(false);
        setCompletedStages(stageList(prepared.timings));
        setAnalysisStep('compressing');
        let images: BatchImage[];
        try {
            images = await renderRegions(prepared, regions);
        } catch (error) {
            frontendLogger.error(logPrefix, 'Crop failed', { error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
            setAnalysisStep('idle');
            return;
        }
        if (multi) {
            setAnalysisStep('idle');
            setCompletedStages([]);
            setLastImported(null);
            saver.setSaveError(null);
            setBatchImages(images);
            return;
        }
        await uploadImage(images[0]);
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
        setCurrentImage(null);
        setParsedData(data);
        setStep("review");
    };

    /** 上传已处理好的图片，创建服务端识别任务；上传完成即关闭遮罩 */
    const uploadImage = async (image: BatchImage) => {
        const startTime = Date.now();
        setCompletedStages(stageList(image.timings));
        try {
            setAnalysisStep('uploading');
            const task = await createImportTask({
                imageBase64: image.dataUrl,
                language,
                subjectId: analyzeSubjectId,
                // 添加页固定错题本；首页指定了错题本时免确认入库放入该错题本，校对时由用户选择
                targetSubjectId: fixedSubjectId ?? (confirmBeforeImport ? null : importSubjectId),
                clientTimings: image.timings,
                imageInfo: image.info,
            });
            const uploadMs = Date.now() - startTime;
            frontendLogger.info(logPrefix, 'Import task created', { taskId: task.id, ...image.info, ...image.timings, uploadMs });
            setPendingTaskId(task.id);
            pending.setTask(task);
            setStep("upload");
        } catch (error) {
            frontendLogger.error(logPrefix, 'Upload failed', { errorDuration: Date.now() - startTime, error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            setAnalysisStep('idle');
            setCompletedStages([]);
        }
    };

    /** 多题批次放入的错题本：与单题上传相同，添加页固定错题本，免确认时放入指定的错题本，校对时由用户选择 */
    const batchTarget = () => fixedSubjectId ?? (confirmBeforeImport ? null : importSubjectId);

    /** 多题文字：创建批次（本地规则分题不调用 AI；splitter 为 ai 时由模型分题），进入分题预览 */
    const createTextBatch = async (text: string, splitter: "local" | "ai", forceNumbered = false) => {
        saver.setSaveError(null);
        setCreatingBatch(true);
        try {
            const batch = await createImportBatch({
                source: "text",
                splitter,
                forceNumbered: forceNumbered || undefined,
                text,
                language,
                subjectId: analyzeSubjectId ?? textNotebook?.id,
                targetSubjectId: batchTarget(),
            });
            frontendLogger.info(logPrefix, 'Text batch created', { batchId: batch.id, splitter, questions: batch.itemCount });
            router.push(`/import-batches/${batch.id}`);
        } catch (error) {
            frontendLogger.error(logPrefix, 'Text batch failed', { error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            setCreatingBatch(false);
        }
    };

    /** 照片自动分题：按所选区域从原图裁剪压缩，上传整页图并在后台由模型分题，进入批次页等待结果 */
    const autoSplitImage = async (region: ImageRegion) => {
        const prepared = preparedRef.current;
        if (!prepared) return;
        setIsCropperOpen(false);
        setCompletedStages(stageList(prepared.timings));
        setAnalysisStep('compressing');
        try {
            const rendered = await renderRegion(prepared, region);
            setCompletedStages(stageList({ ...prepared.timings, ...rendered.timings }));
            setAnalysisStep('uploading');
            const batch = await createImportBatch({
                source: "image",
                imageBase64: rendered.dataUrl,
                imageInfo: describeImage(prepared, rendered),
                language,
                subjectId: analyzeSubjectId,
                targetSubjectId: batchTarget(),
            });
            frontendLogger.info(logPrefix, 'Image batch created', { batchId: batch.id, ...describeImage(prepared, rendered) });
            router.push(`/import-batches/${batch.id}`);
        } catch (error) {
            frontendLogger.error(logPrefix, 'Image batch failed', { error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            setAnalysisStep('idle');
            setCompletedStages([]);
        }
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

    /** 文字解题的校对页保存（图片识别的结果在识别任务的校对页确认入库） */
    const saveReviewed = async (finalData: ReviewedQuestion) => {
        const saved = await saveQuestion({ ...finalData, originalImageUrl: currentImage || "", ...(fixedSubjectId ? { subjectId: fixedSubjectId } : {}) });
        if (saved) {
            setStep("upload");
            setParsedData(null);
            setCurrentImage(null);
        }
    };

    return {
        step, cancelReview: () => { setStep("upload"); saver.setSaveError(null); },
        saveError: saver.saveError, dismissSaveError: saver.dismissSaveError,
        analysisStep, setAnalysisStep, isBusy: analysisStep !== 'idle',
        parsedData, currentImage, aiTimeout,
        croppingImage, isCropperOpen, closeCropper: () => setIsCropperOpen(false),
        lastImported, dismissImported: () => setLastImported(null),
        batchImages, closeBatch: () => setBatchImages(null), completedStages,
        pendingTask: pendingTaskId ? pending.task : null,
        refreshPendingTask: pending.refresh,
        dismissPendingTask: () => setPendingTaskId(null),
        selectImage, cropRegions, submitText, saveQuestion, saveReviewed,
        createTextBatch, autoSplitImage, creatingBatch,
    };
}
