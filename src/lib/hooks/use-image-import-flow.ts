"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getAnalysisErrorMessage } from "@/lib/question/analysis-error";
import { getErrorMessage } from "@/lib/error-message";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { createImportBatch } from "@/lib/import/import-batch-client";
import { createImportTask } from "@/lib/import/import-task-client";
import { ImageDecodeError, prepareImage } from "@/lib/image-pipeline";
import type { PreparedImage } from "@/lib/image-pipeline";
import type { ImageRegion } from "@/lib/image-crop";
import { stackQuestionImages } from "@/lib/import/batch-crop";
import {
    buildCreateTaskParams,
    buildImageBatchParams,
    buildStageList,
    MAX_QUESTION_PARTS,
    renderRegions,
    toStackedBatchImage,
} from "@/lib/import/question-import-flow";
import type { BatchImage } from "@/lib/import/question-import-flow";
import type { ProgressStatus } from "@/components/ui/progress-feedback";
import type { ImportTaskDetail } from "@/lib/import/import-task-types";
import type { Translations } from "@/lib/translations";

export interface ImageFlowDeps {
    logPrefix: string;
    t: Translations;
    language: "zh" | "en";
    analyzeSubjectId?: string | null;
    fixedSubjectId?: string;
    confirmBeforeImport: boolean;
    importSubjectId?: string | null;
    setAnalysisStep: (step: ProgressStatus) => void;
    setTask: (task: ImportTaskDetail) => void;
    setPendingTaskId: (id: string) => void;
    clearLastImported: () => void;
    clearSaveError: () => void;
}

/**
 * 图片导入流程：选择照片 → 裁剪 → 上传创建识别任务 / 批量导入 / 自动分题。
 * 管理裁剪器状态、分段暂存、批量图片与已完成阶段列表。
 */
export function useImageImportFlow(deps: ImageFlowDeps) {
    const { logPrefix, t, language, analyzeSubjectId, fixedSubjectId, confirmBeforeImport, importSubjectId } = deps;
    const router = useRouter();
    const [croppingImage, setCroppingImage] = useState<string | null>(null);
    const [isCropperOpen, setIsCropperOpen] = useState(false);
    const [batchImages, setBatchImages] = useState<BatchImage[] | null>(null);
    const [parts, setParts] = useState<BatchImage[]>([]);
    const [completedStages, setCompletedStages] = useState<ReturnType<typeof buildStageList>>([]);
    const preparedRef = useRef<PreparedImage | null>(null);

    // 离开页面时释放解码后的原图与预览图；只在卸载时执行，重新渲染不能释放（裁剪还要用原图）
    useEffect(() => () => preparedRef.current?.dispose(), []);

    const targetCtx = { fixedSubjectId, confirmBeforeImport, importSubjectId };

    const decodeErrorMessage = (error: ImageDecodeError) =>
        t.upload.decodeErrors[error.code].replace("{format}", error.format.toUpperCase());

    /** 选择照片：读取并解码（HEIC/HEIF 在此转换为 JPEG 并校正方向），生成缩略图后打开裁剪 */
    const selectImage = async (file: File) => {
        deps.clearLastImported();
        deps.clearSaveError();
        setCompletedStages([]);
        deps.setAnalysisStep('reading');
        try {
            const prepared = await prepareImage(file, () => deps.setAnalysisStep('converting'));
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
            deps.setAnalysisStep('idle');
        }
    };

    /** 上传已处理好的图片，创建服务端识别任务；上传完成即关闭遮罩 */
    const uploadImage = async (image: BatchImage) => {
        const startTime = Date.now();
        setCompletedStages(buildStageList(image.timings, t));
        try {
            deps.setAnalysisStep('uploading');
            const task = await createImportTask(buildCreateTaskParams(image, { ...targetCtx, language, analyzeSubjectId }));
            const uploadMs = Date.now() - startTime;
            frontendLogger.info(logPrefix, 'Import task created', { taskId: task.id, ...image.info, ...image.timings, uploadMs });
            deps.setPendingTaskId(task.id);
            deps.setTask(task);
        } catch (error) {
            frontendLogger.error(logPrefix, 'Upload failed', { errorDuration: Date.now() - startTime, error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            deps.setAnalysisStep('idle');
            setCompletedStages([]);
        }
    };

    /** 把各段纵向拼成一张图后上传；失败时保留已暂存的段，可重试 */
    const uploadParts = async (list: BatchImage[]) => {
        deps.setAnalysisStep('compressing');
        let image: BatchImage;
        try {
            const rendered = await stackQuestionImages(list.map((part) => part.dataUrl));
            image = toStackedBatchImage(list, rendered);
        } catch (error) {
            frontendLogger.error(logPrefix, 'Stack parts failed', { parts: list.length, error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
            deps.setAnalysisStep('idle');
            return;
        }
        frontendLogger.info(logPrefix, 'Question parts stacked', { parts: list.length, width: image.info.outputWidth, height: image.info.outputHeight });
        setParts([]);
        await uploadImage(image);
    };

    /** 「下一段在另一张」：框选的这一段暂存起来，回到选图继续拍下一张 */
    const addPart = async (region: ImageRegion) => {
        const prepared = preparedRef.current;
        if (!prepared || parts.length >= MAX_QUESTION_PARTS - 1) return;
        setIsCropperOpen(false);
        deps.setAnalysisStep('compressing');
        try {
            const [image] = await renderRegions(prepared, [region]);
            setParts((current) => [...current, image]);
            toast.info(t.upload.parts.added.replace("{n}", String(parts.length + 1)));
        } catch (error) {
            frontendLogger.error(logPrefix, 'Crop part failed', { error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            deps.setAnalysisStep('idle');
        }
    };

    /** 裁剪完成：单题直接上传（有暂存的段时与其拼成一题），多题进入批量导入 */
    const cropRegions = async (regions: ImageRegion[], multi: boolean) => {
        const prepared = preparedRef.current;
        if (!prepared || regions.length === 0) return;
        setIsCropperOpen(false);
        setCompletedStages(buildStageList(prepared.timings, t));
        deps.setAnalysisStep('compressing');
        let images: BatchImage[];
        try {
            images = await renderRegions(prepared, regions);
        } catch (error) {
            frontendLogger.error(logPrefix, 'Crop failed', { error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
            deps.setAnalysisStep('idle');
            return;
        }
        if (multi) {
            deps.setAnalysisStep('idle');
            setCompletedStages([]);
            deps.clearLastImported();
            deps.clearSaveError();
            setBatchImages(images);
            return;
        }
        if (parts.length > 0) {
            await uploadParts([...parts, images[0]]);
            return;
        }
        await uploadImage(images[0]);
    };

    /** 照片自动分题：按所选区域从原图裁剪压缩，上传整页图并在后台由模型分题，进入批次页等待结果 */
    const autoSplitImage = async (region: ImageRegion) => {
        const prepared = preparedRef.current;
        if (!prepared) return;
        setIsCropperOpen(false);
        setCompletedStages(buildStageList(prepared.timings, t));
        deps.setAnalysisStep('compressing');
        try {
            const [image] = await renderRegions(prepared, [region]);
            setCompletedStages(buildStageList(image.timings, t));
            deps.setAnalysisStep('uploading');
            const batch = await createImportBatch(buildImageBatchParams(image, { ...targetCtx, language, analyzeSubjectId }));
            frontendLogger.info(logPrefix, 'Image batch created', { batchId: batch.id, ...image.info });
            router.push(`/import-batches/${batch.id}`);
        } catch (error) {
            frontendLogger.error(logPrefix, 'Image batch failed', { error: getErrorMessage(error) });
            toast.error(getAnalysisErrorMessage(error, t));
        } finally {
            deps.setAnalysisStep('idle');
            setCompletedStages([]);
        }
    };

    return {
        croppingImage, isCropperOpen, setIsCropperOpen,
        batchImages, setBatchImages,
        parts, setParts,
        completedStages,
        preparedRef,
        selectImage, cropRegions, addPart,
        uploadImage, uploadParts, autoSplitImage,
        finishParts: () => uploadParts(parts),
        discardParts: () => setParts([]),
        closeBatch: () => setBatchImages(null),
        closeCropper: () => setIsCropperOpen(false),
    };
}
