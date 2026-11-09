"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Shapes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageCropper } from "@/components/image-cropper";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient, ApiError } from "@/lib/api-client";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { useRunningTask } from "@/lib/hooks/use-running-task";
import { blobFromDataUrl } from "@/lib/image-crop";
import type { ImageRegion } from "@/lib/image-crop";
import { ImageDecodeError, prepareImage, renderRegion } from "@/lib/image-pipeline";
import type { PreparedImage } from "@/lib/image-pipeline";

interface RegenerateFigureButtonProps {
    errorItemId: string;
    /** 当前题目原图；提供时先框选配图区域再交给 AI */
    originalImageUrl?: string | null;
    /** 生成完成后回调新的配图（无配图时为 null） */
    onDone: (figure: { hasFigure: boolean; figureSvg: string | null }) => void;
}

/** 用原题图片（可框选配图区域）让 AI 重新绘制 SVG 配图 */
export function RegenerateFigureButton({ errorItemId, originalImageUrl, onDone }: RegenerateFigureButtonProps) {
    const { t } = useLanguage();
    const [running, setRunning] = useState(false);
    const [preparing, setPreparing] = useState(false);
    const [prepared, setPrepared] = useState<PreparedImage | null>(null);
    const target = `error-item:${errorItemId}:figure`;
    const { running: taskRunning, refresh } = useRunningTask(target);
    // 任务从进行中变为结束后刷新数据（结果已由服务端写入数据库，onDone 触发父组件重新加载）
    const wasRunning = useRef(false);
    useEffect(() => {
        if (taskRunning) {
            wasRunning.current = true;
            return;
        }
        if (wasRunning.current) {
            wasRunning.current = false;
            // 任务结束后重新加载该错题数据，使服务端已保存的配图显示出来
            apiClient.get<{ hasFigure: boolean; figureSvg: string | null }>(`/api/error-items/${errorItemId}`)
                .then((item) => onDone({ hasFigure: item.hasFigure, figureSvg: item.figureSvg }))
                .catch((error) => frontendLogger.warn("[RegenerateFigure]", "Failed to reload figure", { error }));
        }
    }, [taskRunning, errorItemId, onDone]);
    useEffect(() => () => prepared?.dispose(), [prepared]);

    const regenerate = async (imageBase64?: string) => {
        setRunning(true);
        try {
            const figure = await apiClient.post<{ hasFigure: boolean; figureSvg: string | null }>(
                `/api/error-items/${errorItemId}/figure`,
                imageBase64 ? { imageBase64 } : {},
                { recoverable: true },
            );
            onDone(figure);
            if (!figure.figureSvg) toast.warning(t.figure.noFigure);
        } catch (error) {
            if (error instanceof ApiError && error.status === 409 && (error.data as { code?: string })?.code === "TASK_ALREADY_RUNNING") {
                toast.info(t.errors.TASK_ALREADY_RUNNING);
                await refresh();
            } else {
                const code = (error as { data?: { message?: string } })?.data?.message || "";
                const mapped = (t.errors as Record<string, unknown>)[code];
                frontendLogger.error('[RegenerateFigure]', 'Failed to regenerate figure', { code });
                toast.error(code === "NO_ORIGINAL_IMAGE" ? t.figure.noImage : typeof mapped === "string" ? mapped : t.figure.failed);
            }
        } finally {
            setRunning(false);
        }
    };

    const handleClick = async () => {
        const blob = originalImageUrl ? blobFromDataUrl(originalImageUrl) : null;
        if (!blob) {
            await regenerate();
            return;
        }
        setPreparing(true);
        try {
            setPrepared(await prepareImage(blob));
        } catch (error) {
            frontendLogger.warn("[RegenerateFigure]", "Failed to decode original image", { error });
            toast.error(error instanceof ImageDecodeError
                ? t.upload.decodeErrors[error.code].replace("{format}", error.format.toUpperCase())
                : t.figure.noImage);
        } finally {
            setPreparing(false);
        }
    };

    const handleRegions = async (regions: ImageRegion[]) => {
        const source = prepared;
        if (!source || regions.length === 0) return;
        setPrepared(null);
        try {
            const rendered = await renderRegion(source, regions[0]);
            source.dispose();
            await regenerate(rendered.dataUrl);
        } catch (error) {
            frontendLogger.error("[RegenerateFigure]", "Failed to crop figure", { error });
            toast.error(t.figure.failed);
        }
    };

    const busy = preparing || running || !!taskRunning;
    return (
        <>
            {prepared && (
                <ImageCropper
                    imageSrc={prepared.previewUrl}
                    open
                    onClose={() => setPrepared(null)}
                    allowMulti={false}
                    eraseEnabled={false}
                    onRegionsSelected={(regions) => void handleRegions(regions)}
                />
            )}
            <Button variant="outline" size="sm" onClick={handleClick} disabled={busy} className="flex items-center gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shapes className="h-4 w-4" />}
                {busy ? t.figure.regenerating : t.figure.regenerate}
            </Button>
        </>
    );
}
