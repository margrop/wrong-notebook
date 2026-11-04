/**
 * 题干预览截断：去掉 Markdown/LaTeX 换行、合并多余空白，截取前 maxChars 个字符，超出加省略号。
 * 空白题干返回 null。
 */
export function truncateQuestionPreview(text: string | null | undefined, maxChars = 60): string | null {
    if (!text) return null;
    // 去 Markdown/LaTeX 换行与多余空白
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return null;
    if (cleaned.length <= maxChars) return cleaned;
    return cleaned.slice(0, maxChars) + '…';
}
