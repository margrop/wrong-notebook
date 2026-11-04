/**
 * 错题卡片的题干摘要：去掉 Markdown 格式，但保留公式源码，交给 KaTeX 渲染，
 * 避免复杂 LaTeX（嵌套分数、向量、三角函数等）被正则转成难以阅读的残留文本。
 */
import { cleanMarkdown } from '@/lib/markdown-utils';
import { extractMathSegments } from '@/lib/markdown-math';

/** 摘要片段：普通文字或行内公式 */
export type SummaryPart =
    | { type: 'text'; value: string }
    | { type: 'math'; tex: string };

const PLACEHOLDER_SPLIT = /@@MATH(\d+)@@/;

/** 公式按源码长度的一半计入摘要长度（渲染后通常比源码短） */
function mathWeight(tex: string): number {
    return Math.max(1, Math.ceil(tex.length / 2));
}

/**
 * 取题干第一段生成摘要，超过 maxLength 时截断并加省略号；公式不会被截断到一半
 */
export function buildQuestionSummary(questionText: string | null | undefined, maxLength: number): SummaryPart[] {
    const { masked, segments } = extractMathSegments(questionText);
    // 先抽出公式再分段，避免 $$…$$ 块内的空行把公式拆开
    const firstParagraph = masked.trim().split(/\n\s*\n/)[0] ?? '';
    const cleaned = cleanMarkdown(firstParagraph);
    const pieces = cleaned.split(PLACEHOLDER_SPLIT);

    const parts: SummaryPart[] = [];
    let used = 0;
    let truncated = false;

    for (let i = 0; i < pieces.length && !truncated; i++) {
        if (i % 2 === 0) {
            const text = pieces[i];
            if (!text) continue;
            const remaining = maxLength - used;
            if (text.length > remaining) {
                parts.push({ type: 'text', value: text.substring(0, remaining) });
                truncated = true;
            } else {
                parts.push({ type: 'text', value: text });
                used += text.length;
            }
        } else {
            const tex = segments[Number(pieces[i])]?.tex.trim();
            if (!tex) continue;
            const weight = mathWeight(tex);
            if (used + weight > maxLength && used > 0) {
                truncated = true;
            } else {
                parts.push({ type: 'math', tex });
                used += weight;
            }
        }
    }

    if (truncated) {
        // 省略号接在最后一段文字后；最后是公式时单独追加
        const last = parts[parts.length - 1];
        if (last?.type === 'text') {
            last.value = `${last.value.trimEnd()}...`;
        } else {
            parts.push({ type: 'text', value: '...' });
        }
    }
    return parts;
}
