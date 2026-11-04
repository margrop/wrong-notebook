import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { prepareMarkdownMath } from '@/lib/markdown-math';

/** 由下划线组成的分隔线（如 ____）：题目中的作答横线，而非 --- / *** 分隔线 */
function isWritingLine(source: string): boolean {
    return /^_[_ \t]*$/.test(source.trim());
}

interface MarkdownRendererProps {
    content?: string | null;
    className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
    // 公式片段先保护起来，只整理公式以外的文字（见 markdown-math.ts）
    const processedContent = prepareMarkdownMath(content);

    return (
        <div className={`markdown-content overflow-x-auto min-w-0 ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm]}
                rehypePlugins={[rehypeKatex]}
                components={{
                    // 自定义样式
                    h1: ({ node, ...props }) => <h1 className="text-2xl font-bold mt-6 mb-4" {...props} />,
                    h2: ({ node, ...props }) => <h2 className="text-xl font-bold mt-5 mb-3" {...props} />,
                    h3: ({ node, ...props }) => <h3 className="text-lg font-bold mt-4 mb-2" {...props} />,
                    p: ({ node, ...props }) => <p className="mb-3 leading-relaxed" {...props} />,
                    ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-3 space-y-1" {...props} />,
                    ol: ({ node, ...props }) => <ol className="list-decimal list-inside mb-3 space-y-1" {...props} />,
                    li: ({ node, ...props }) => <li className="ml-4" {...props} />,
                    blockquote: ({ node, ...props }) => (
                        <blockquote className="border-l-4 border-primary pl-4 italic my-4 text-muted-foreground" {...props} />
                    ),
                    // react-markdown 10 不再传 inline：code 统一按行内样式，代码块样式由 pre 提供并重置内部 code
                    code: ({ node, className, ...props }) => (
                        <code className={`bg-muted px-1.5 py-0.5 rounded text-sm font-mono ${className ?? ''}`} {...props} />
                    ),
                    pre: ({ node, ...props }) => (
                        <pre className="bg-muted p-4 rounded-lg overflow-x-auto my-3 font-mono text-sm [&>code]:bg-transparent [&>code]:p-0 [&>code]:rounded-none" {...props} />
                    ),
                    table: ({ node, ...props }) => (
                        <div className="overflow-x-auto my-4">
                            <table className="min-w-full border-collapse border border-border" {...props} />
                        </div>
                    ),
                    th: ({ node, ...props }) => (
                        <th className="border border-border px-4 py-2 bg-muted font-semibold text-left" {...props} />
                    ),
                    td: ({ node, ...props }) => (
                        <td className="border border-border px-4 py-2" {...props} />
                    ),
                    // 单独成行的 ____ 在 Markdown 中是分隔线，题目里实为作答横线：上方留出书写高度，并加深线条便于打印
                    hr: ({ node, ...props }) => {
                        const start = node?.position?.start.offset;
                        const end = node?.position?.end.offset;
                        const source = typeof start === 'number' && typeof end === 'number'
                            ? processedContent.slice(start, end)
                            : '';
                        return isWritingLine(source)
                            ? <hr className="writing-line mt-10 mb-4 border-0 border-t border-foreground/70" {...props} />
                            : <hr className="my-4 border-border" {...props} />;
                    },
                    strong: ({ node, ...props }) => <strong className="font-bold" {...props} />,
                    em: ({ node, ...props }) => <em className="italic" {...props} />,
                }}
            >
                {processedContent}
            </ReactMarkdown>
        </div>
    );
}
