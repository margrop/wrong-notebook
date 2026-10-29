"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProgressStatus } from "@/components/ui/progress-feedback";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ParsedQuestion } from "@/lib/ai";
import { getAnalysisErrorMessage } from "@/lib/analysis-error";
import { apiClient } from "@/lib/api-client";
import { getApiErrorMessage, getErrorMessage } from "@/lib/error-message";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { processImageFile } from "@/lib/image-utils";
import { normalizeMistakeStatus } from "@/lib/mistake-status";
import { fetchConfirmBeforeImport, saveParsedQuestion } from "@/lib/question-import";
import type { ImportedQuestion } from "@/lib/question-import";
import type { AnalyzeResponse, AppConfig } from "@/types/api";

/** 未配置时 AI 识别的超时（毫秒） */
const DEFAULT_AI_TIMEOUT = 180000;

export type ReviewedQuestion = ParsedQuestion & { subjectId?: string; gradeSemester?: string; paperLevel?: string };

interface ReanswerResponse {
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
 * 题目导入流程：裁剪图片 → 压缩 → AI 识别（或文字解题）→ 免确认直接入库，或进入校对页后保存。
 * 首页与错题本的添加错题页共用。
 */
export function useQuestionImport({ logPrefix, analyzeSubjectId, importSubjectId, textNotebook, fixedSubjectId, onParsed }: QuestionImportOptions) {
    const { t, language } = useLanguage();
    const router = useRouter();
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
        setCroppingImage(URL.createObjectURL(file));
        setIsCropperOpen(true);
    };

    const startBatch = (blobs: Blob[]) => {
        setIsCropperOpen(false);
        setLastImported(null);
        setBatchBlobs(blobs);
    };

    /** 识别结果：未开启人工确认时直接入库，否则进入校对页 */
    const handleParsed = async (data: ParsedQuestion, imageUrl: string | null) => {
        if (!confirmBeforeImport) {
            setAnalysisStep('saving');
            const imported = await saveParsedQuestion(data, { subjectId: importSubjectId, imageUrl });
            setLastImported(imported);
            setCurrentImage(null);
            frontendLogger.info(logPrefix, 'Imported without review', { id: imported.id });
            return;
        }
        setCurrentImage(imageUrl);
        setParsedData(data);
        setStep("review");
    };

    const analyzeImage = async (file: File) => {
        const startTime = Date.now();
        frontendLogger.info(logPrefix, 'Starting analysis flow', { apiTimeout: aiTimeout, safetyTimeout });
        try {
            setAnalysisStep('compressing');
            const base64Image = await processImageFile(file);

            setAnalysisStep('analyzing');
            const data = await apiClient.post<AnalyzeResponse>("/api/analyze", {
                imageBase64: base64Image,
                language,
                subjectId: analyzeSubjectId || undefined,
            }, { timeout: aiTimeout, recoverable: true });
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid API response: data is null or not an object');
            }

            setAnalysisStep('processing');
            if (confirmBeforeImport) onParsed?.(data);
            await handleParsed(data, base64Image);
            frontendLogger.info(logPrefix, 'Analysis completed', { totalDuration: Date.now() - startTime });
        } catch (error) {
            frontendLogger.error(logPrefix, 'Analysis failed', { errorDuration: Date.now() - startTime, error: getErrorMessage(error) });
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
        const startTime = Date.now();
        frontendLogger.info(logPrefix, 'Starting text-based analysis', { textLength: questionText.length });
        try {
            setAnalysisStep('analyzing');
            const result = await apiClient.post<ReanswerResponse>("/api/reanswer", {
                questionText,
                language,
                subject: textNotebook?.name,
                subjectId: textNotebook?.id,
            }, { timeout: aiTimeout, recoverable: true });

            setAnalysisStep('processing');
            await handleParsed({
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
            }, null);
            frontendLogger.info(logPrefix, 'Text analysis completed', { totalDuration: Date.now() - startTime });
        } catch (error) {
            frontendLogger.error(logPrefix, 'Text analysis failed', { errorDuration: Date.now() - startTime, error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            setAnalysisStep('idle');
        }
    };

    /** 保存题目；重复题跳到原题，否则跳到所在错题本 */
    const saveQuestion = async (payload: Record<string, unknown> & { subjectId?: string | null }) => {
        try {
            const result = await apiClient.post<{ id: string; duplicate?: boolean }>("/api/error-items", payload);
            toast.success(result.duplicate ? t.importFlow.duplicate : t.common.messages.saveSuccess);
            if (result.duplicate) {
                router.push(`/error-items/${result.id}`);
            } else if (payload.subjectId) {
                router.push(`/notebooks/${payload.subjectId}`);
            }
            return true;
        } catch (error) {
            frontendLogger.error(logPrefix, 'Save failed', { errorMessage: getApiErrorMessage(error) ?? getErrorMessage(error) });
            toast.error(t.common?.messages?.saveFailed || 'Failed to save');
            return false;
        }
    };

    /** 校对页保存 */
    const saveReviewed = async (finalData: ReviewedQuestion) => {
        const saved = await saveQuestion({
            ...finalData,
            originalImageUrl: currentImage || "",
            ...(fixedSubjectId ? { subjectId: fixedSubjectId } : {}),
        });
        if (saved) {
            setStep("upload");
            setParsedData(null);
            setCurrentImage(null);
        }
    };

    return {
        step, cancelReview: () => setStep("upload"),
        analysisStep, setAnalysisStep, isBusy: analysisStep !== 'idle',
        parsedData, currentImage, aiTimeout,
        croppingImage, isCropperOpen, closeCropper: () => setIsCropperOpen(false),
        lastImported, dismissImported: () => setLastImported(null),
        batchBlobs, closeBatch: () => setBatchBlobs(null),
        selectImage, cropComplete, startBatch, submitText, saveQuestion, saveReviewed,
    };
}
