"use client";

import { MarkdownRenderer } from "@/components/markdown-renderer";
import { QuestionFigure } from "@/components/question-figure";
import { useLanguage } from "@/contexts/LanguageContext";
import type { PrintableErrorItem } from "@/types/api";
import type { PrintDisplayOptions } from "./print-options";

interface PrintableQuestionProps {
    item: PrintableErrorItem;
    index: number;
    options: PrintDisplayOptions;
    /** 显示答案或解析时题目之间多留空白，便于手写 */
    reserveAnswerSpace: boolean;
}

/** 题目的知识点：优先使用 tags 关联，旧数据回退到 knowledgePoints */
function tagNames(item: PrintableErrorItem): string[] {
    if (item.tags && item.tags.length > 0) return item.tags.map((tag) => tag.name);
    try {
        const parsed: unknown = JSON.parse(item.knowledgePoints || "[]");
        return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
    } catch {
        return [];
    }
}

/** 打印页中的一道题：题号、来源信息、原图或文字，以及可选的答案和解析 */
export function PrintableQuestion({ item, index, options, reserveAnswerSpace }: PrintableQuestionProps) {
    const { t } = useLanguage();
    const tags = tagNames(item);

    return (
        <div className={`mb-4 border-b last:border-b-0 print:break-inside-avoid ${reserveAnswerSpace ? "pb-20 print:pb-16" : "pb-6"}`}>
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 leading-7">
                <span className="text-lg font-bold">
                    {t.printPreview?.questionNumber?.replace('{num}', String(index + 1)) || `Question ${index + 1}`}
                </span>
                {/* 题目编号：做完后按编号定位原题、录入结果 */}
                {item.shortId && (
                    <span className="font-mono text-sm text-muted-foreground whitespace-nowrap">
                        {t.printPreview.source.replace('{id}', item.shortId)}
                    </span>
                )}
                {item.subject && <span className="text-sm text-muted-foreground">{item.subject.name}</span>}
                {item.gradeSemester && <span className="text-sm text-muted-foreground">{item.gradeSemester}</span>}
                {item.paperLevel && (
                    <span className="text-sm text-muted-foreground">
                        {t.printPreview?.paperLevel || 'Paper Level'}: {item.paperLevel.toUpperCase()}
                    </span>
                )}
                {options.showTags && tags.length > 0 && (
                    <>
                        <span className="font-semibold">{t.printPreview?.knowledgePoints || 'Knowledge Points'}:</span>
                        {tags.map((tag, tagIndex) => (
                            <span key={`${tag}-${tagIndex}`} className="px-2 py-1 bg-muted rounded text-sm">{tag}</span>
                        ))}
                    </>
                )}
            </div>

            {options.showQuestionText && item.questionText ? (
                <div className="mb-4">
                    <MarkdownRenderer content={item.questionText} />
                    {/* 有 SVG 配图时打印配图，不再打印拍照原图 */}
                    <QuestionFigure svg={item.figureSvg} />
                </div>
            ) : (
                item.originalImageUrl && (
                    <div className="mb-4">
                        <img
                            src={item.originalImageUrl}
                            alt={t.detail?.originalProblem || 'Question Image'}
                            className="h-auto border rounded"
                            style={{ maxWidth: `${options.imageScale}%` }}
                        />
                    </div>
                )
            )}

            {options.showAnswers && item.answerText && (
                <div className="mb-4">
                    <h3 className="font-semibold mb-2">{t.printPreview?.referenceAnswer || 'Reference Answer'}:</h3>
                    <MarkdownRenderer content={item.answerText} />
                </div>
            )}

            {options.showAnalysis && item.analysis && (
                <div className="mb-4">
                    <h3 className="font-semibold mb-2">{t.printPreview?.analysis || 'Analysis'}:</h3>
                    <MarkdownRenderer content={item.analysis} />
                </div>
            )}
        </div>
    );
}
