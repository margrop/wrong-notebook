"use client";

import { useMemo } from "react";
import katex from "katex";
import { cleanMarkdown } from "@/lib/markdown-utils";
import { buildQuestionSummary } from "@/lib/question-summary";
import "katex/dist/katex.min.css";

interface QuestionSummaryProps {
    text: string | null | undefined;
    maxLength: number;
    className?: string;
}

/** 行内渲染公式；KaTeX 无法解析时退回到纯文本 */
function renderMath(tex: string): { html: string } | { text: string } {
    try {
        return { html: katex.renderToString(tex, { displayMode: false, throwOnError: true, strict: "ignore" }) };
    } catch {
        return { text: cleanMarkdown(`$${tex}$`) };
    }
}

/** 错题卡片的题干摘要：文字去掉 Markdown 格式，公式用 KaTeX 行内渲染 */
export function QuestionSummary({ text, maxLength, className = "" }: QuestionSummaryProps) {
    const parts = useMemo(() => buildQuestionSummary(text, maxLength), [text, maxLength]);

    return (
        <div className={`[&_.katex]:text-[1.05em] ${className}`}>
            {parts.map((part, index) => {
                if (part.type === "text") return <span key={index}>{part.value}</span>;
                const rendered = renderMath(part.tex);
                return "html" in rendered
                    // KaTeX 输出已转义用户内容（默认 trust: false），可直接插入
                    ? <span key={index} dangerouslySetInnerHTML={{ __html: rendered.html }} />
                    : <span key={index}>{rendered.text}</span>;
            })}
        </div>
    );
}
