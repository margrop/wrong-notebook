"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageCropper } from "@/components/image-cropper";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import type { ImageRegion } from "@/lib/image-crop";
import { ImageDecodeError, prepareImage, renderRegion } from "@/lib/image-pipeline";
import type { PreparedImage } from "@/lib/image-pipeline";
import { toast, confirmDialog } from "@/lib/feedback";

interface ReplaceQuestionImageButtonProps {
    errorItemId: string;
    /** 题目已有原图时替换前二次确认 */
    hasImage: boolean;
    onDone: (originalImageUrl: string) => void;
}

/**
 * 替换原题图片：与导入题目一样，先选择图片（支持 HEIC/HEIF）并截取题目所在区域，从原图裁剪后按尺寸与体积限制压缩再保存
 */
export function ReplaceQuestionImageButton({ errorItemId, hasImage, onDone }: ReplaceQuestionImageButtonProps) {
    const { t } = useLanguage();
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    // 已解码的原图与裁剪预览，关闭裁剪框或换图时释放
    const [prepared, setPrepared] = useState<PreparedImage | null>(null);

    useEffect(() => () => prepared?.dispose(), [prepared]);

    const handleClick = async () => {
        if (hasImage && !(await confirmDialog(t.replaceImage.confirm))) return;
        inputRef.current?.click();
    };

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true);
        try {
            setPrepared(await prepareImage(file));
        } catch (error) {
            toast.error(error instanceof ImageDecodeError
                ? t.upload.decodeErrors[error.code].replace("{format}", error.format.toUpperCase())
                : t.replaceImage.invalid);
        } finally {
            setUploading(false);
        }
    };

    const handleRegions = async (regions: ImageRegion[]) => {
        const source = prepared;
        if (!source || regions.length === 0) return;
        setUploading(true);
        try {
            const { dataUrl: imageDataUrl } = await renderRegion(source, regions[0]);
            setPrepared(null);
            const result = await apiClient.put<{ originalImageUrl: string }>(`/api/error-items/${errorItemId}/image`, { imageDataUrl });
            onDone(result.originalImageUrl);
            toast.success(t.replaceImage.done);
        } catch (error) {
            const code = (error as { data?: { message?: string } })?.data?.message || "";
            frontendLogger.error('[ReplaceImage]', 'Failed to replace original image', { code });
            toast.error(code === "INVALID_IMAGE" ? t.replaceImage.invalid : t.replaceImage.failed);
        } finally {
            setUploading(false);
        }
    };

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={(e) => {
                    handleFile(e.target.files?.[0]);
                    e.target.value = "";
                }}
            />
            {prepared && (
                <ImageCropper
                    imageSrc={prepared.previewUrl}
                    open={!uploading}
                    onClose={() => setPrepared(null)}
                    allowMulti={false}
                    onRegionsSelected={(regions) => void handleRegions(regions)}
                />
            )}
            <Button variant="outline" size="sm" onClick={handleClick} disabled={uploading} className="flex items-center gap-2">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {uploading ? t.replaceImage.uploading : hasImage ? t.replaceImage.replace : t.replaceImage.add}
            </Button>
        </>
    );
}
