/** Openclaw 批量上传图片校验 */

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

export interface ImageValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * 校验单张图片：base64 非空、扩展名与 MIME 类型为 JPG/PNG、大小不超过 5MB。
 */
export function validateImage(base64: string, filename: string, mimeType: string): ImageValidationResult {
    if (!base64 || base64.length === 0) {
        return { valid: false, error: '图片数据为空' };
    }

    const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
        return { valid: false, error: `不支持的图片格式: ${extension}，仅支持 JPG、PNG` };
    }

    // mimeType 会写入题目原图的 data URL，须与扩展名一样限定为 JPG、PNG
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        return { valid: false, error: `不支持的图片类型: ${String(mimeType).slice(0, 50)}，仅支持 image/jpeg、image/png` };
    }

    const estimatedSize = (base64.length * 3) / 4;
    if (estimatedSize > MAX_IMAGE_SIZE) {
        return { valid: false, error: `图片大小超过限制: ${Math.round(estimatedSize / 1024 / 1024)}MB > 5MB` };
    }

    return { valid: true };
}
