/**
 * 识别时裁剪出的原配图（PNG data URI）的净化与长度限制。前后端共用。
 * 化学结构式等复杂图形用原图显示比 AI 重绘更准确，保存为独立字段便于切换。
 */

/** 单个原配图的最大长度（字符）；1600 像素 PNG 通常远低于此值 */
export const MAX_FIGURE_IMAGE_LENGTH = 2_000_000;

const PNG_DATA_URI = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/** 只接受 base64 PNG data URI，超长或格式不符时返回 null */
export function sanitizeFigureImage(raw: unknown, maxLength: number = MAX_FIGURE_IMAGE_LENGTH): string | null {
    if (typeof raw !== "string") return null;
    const value = raw.trim();
    if (value.length > maxLength) return null;
    return PNG_DATA_URI.test(value) ? value : null;
}
