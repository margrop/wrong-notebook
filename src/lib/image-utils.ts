import { frontendLogger } from "@/lib/frontend-logger";
import { describeImage, processImageBlob } from "@/lib/image-pipeline";

/**
 * 处理一张完整图片（不裁剪）：识别真实格式（含 HEIC/HEIF 转换与方向处理），
 * 按最长边、总像素和体积限制编码为 JPEG，返回 data URL。
 * 限制与质量策略见 image-pipeline.ts。
 */
export async function processImageFile(file: Blob): Promise<string> {
    const { prepared, rendered } = await processImageBlob(file);
    frontendLogger.info('[ImageCompress]', 'Image processed', {
        ...describeImage(prepared, rendered),
        ...prepared.timings,
        ...rendered.timings,
    });
    return rendered.dataUrl;
}
