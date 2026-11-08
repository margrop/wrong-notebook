"use client";

import { useEffect, useState } from "react";
import { Crop, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageCropper } from "@/components/image-cropper";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { confirmDialog, toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import type { ImageRegion } from "@/lib/image-crop";
import { ImageDecodeError, prepareImage, renderRegion } from "@/lib/image-pipeline";
import type { PreparedImage } from "@/lib/image-pipeline";

const DATA_IMAGE_URL = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([\s\S]+)$/;

/** 把已保存的原图 data URL 还原为 Blob，供裁剪时解码原图分辨率 */
function blobFromDataUrl(dataUrl: string): Blob | null {
    const match = dataUrl.match(DATA_IMAGE_URL);
    if (!match) return null;
    try {
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        return new Blob([bytes], { type: match[1] });
    } catch {
        return null;
    }
}

interface CropFromOriginalImageButtonProps {
    errorItemId: string;
    imageUrl: string;
    onDone: (originalImageUrl: string) => void;
}
/** 从 API 错误响应中取服务端返回的错误码，非预期形状时返回空字符串 */
function apiErrorCode(error: unknown): string {
    if (typeof error !== "object" || error === null || !("data" in error)) return "";
    const data = error.data;
    if (typeof data !== "object" || data === null || !("message" in data)) return "";
    return typeof data.message === "string" ? data.message : "";
}

/**
 * 从当前原题图片截取新的题目图片：可框选题目区域并擦除做题痕迹，
 * 与替换原图一样按尺寸与体积限制压缩后保存，覆盖原图。
 */
export function CropFromOriginalImageButton({ errorItemId, imageUrl, onDone }: CropFromOriginalImageButtonProps) {
    const { t } = useLanguage();
    const [busy, setBusy] = useState(false);
    const [prepared, setPrepared] = useState<PreparedImage | null>(null);

    useEffect(() => () => prepared?.dispose(), [prepared]);

    const handleClick = async () => {
        if (!(await confirmDialog(t.replaceImage.cropConfirm))) return;
        const blob = blobFromDataUrl(imageUrl);
        if (!blob) {
            toast.error(t.replaceImage.cropNoImage);
            return;
        }
        setBusy(true);
        try {
            setPrepared(await prepareImage(blob));
        } catch (error) {
            frontendLogger.warn("[CropOriginal]", "Failed to decode original image", { error });
            toast.error(error instanceof ImageDecodeError
                ? t.upload.decodeErrors[error.code].replace("{format}", error.format.toUpperCase())
                : t.replaceImage.invalid);
        } finally {
            setBusy(false);
        }
    };

    const handleRegions = async (regions: ImageRegion[]) => {
        const source = prepared;
        if (!source || regions.length === 0) return;
        setBusy(true);
        try {
            const { dataUrl: imageDataUrl } = await renderRegion(source, regions[0]);
            setPrepared(null);
            const result = await apiClient.put<{ originalImageUrl: string }>(`/api/error-items/${errorItemId}/image`, { imageDataUrl });
            onDone(result.originalImageUrl);
            toast.success(t.replaceImage.cropDone);
        } catch (error) {
            const code = apiErrorCode(error);
            frontendLogger.error("[CropOriginal]", "Failed to crop original image", { code });
            toast.error(code === "INVALID_IMAGE" ? t.replaceImage.invalid : t.replaceImage.cropFailed);
        } finally {
            setBusy(false);
        }
    };
    return (
        <>
            {prepared && (
                <ImageCropper
                    imageSrc={prepared.previewUrl}
                    open={!busy}
                    onClose={() => setPrepared(null)}
                    allowMulti={false}
                    onRegionsSelected={(regions) => void handleRegions(regions)}
                />
            )}
            <Button variant="outline" size="sm" onClick={handleClick} disabled={busy} className="flex items-center gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crop className="h-4 w-4" />}
                {busy ? t.replaceImage.uploading : t.replaceImage.crop}
            </Button>
        </>
    );
}
