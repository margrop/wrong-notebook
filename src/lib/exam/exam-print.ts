/** 与项目依赖版本一致的 KaTeX 样式，导出的 HTML 依赖它渲染公式 */
export const KATEX_CSS_URL = "https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css";

/** 试卷打印样式：页面内与导出的独立 HTML 共用，不依赖 Tailwind */
export const EXAM_PRINT_CSS = `
.exam-sheet { max-width: 210mm; margin: 0 auto; padding: 16px; color: #111; background: #fff; color-scheme: light; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.6; }
.exam-sheet h1 { text-align: center; font-size: 22px; margin: 0 0 8px; }
.exam-sheet .exam-full-score { text-align: center; font-size: 14px; margin: 0 0 8px; }
.exam-sheet .exam-meta { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 32px; font-size: 14px; margin-bottom: 20px; }
.exam-sheet .exam-meta span { min-width: 120px; }
.exam-sheet .exam-question { break-inside: avoid; page-break-inside: avoid; padding: 12px 0; border-bottom: 1px dashed #ccc; }
.exam-sheet .exam-question-head { display: flex; justify-content: space-between; gap: 12px; font-weight: 600; }
.exam-sheet .exam-source { font-family: ui-monospace, Menlo, monospace; font-weight: 400; font-size: 12px; color: #666; white-space: nowrap; }
.exam-sheet .exam-answer-space { min-height: 0; }
.exam-sheet .exam-answer-key { break-before: page; page-break-before: always; padding-top: 8px; }
.exam-sheet .exam-answer-key h2 { text-align: center; font-size: 18px; margin: 0 0 12px; }
.exam-sheet .exam-label { font-weight: 600; color: #444; }
/* 按题型分大题的标题行：加粗、上下边框，黑白打印醒目 */
.exam-sheet .exam-section-head { break-after: avoid; page-break-after: avoid; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin: 16px 0 4px; padding: 6px 0; border-top: 2px solid #111; border-bottom: 1px solid #111; }
.exam-sheet .exam-section-head h2 { font-size: 16px; margin: 0; }
.exam-sheet .exam-section-summary { font-size: 13px; color: #333; }
.exam-sheet .markdown-content p { margin: 4px 0; }
.exam-sheet .markdown-content img { max-width: 100%; }
.exam-sheet .question-figure { margin: 8px 0; break-inside: avoid; page-break-inside: avoid; }
.exam-sheet .question-figure img { display: block; margin: 0 auto; max-width: 100%; max-height: 360px; background: #fff; }
.exam-sheet .markdown-content table { border-collapse: collapse; }
.exam-sheet .markdown-content td, .exam-sheet .markdown-content th { border: 1px solid #999; padding: 2px 6px; }
@media print { .exam-sheet { padding: 0; max-width: none; } .exam-sheet .figure-scale-editor-controls, .exam-sheet .answer-space-controls { display: none; } @page { size: A4; margin: 15mm; } }
`;

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

/** 将页面上已渲染好的试卷 HTML 包装成可离线打开的独立文档 */
export function buildExamHtmlDocument(title: string, bodyHtml: string, lang: string = 'zh-CN'): string {
    return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${KATEX_CSS_URL}">
<style>body { margin: 0; background: #fff; }${EXAM_PRINT_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

/** 生成下载用的文件名，去掉文件系统不允许的字符 */
export function examFileName(title: string): string {
    return `${title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || 'exam'}.html`;
}
