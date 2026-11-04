"use client";

import { memo } from "react";
import { X } from "lucide-react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { AnswerSpaceControl } from "@/components/print-preview/answer-space-control";
import { QuestionFigure } from "@/components/question-figure";
import { useLanguage } from "@/contexts/LanguageContext";
import { resolveQuestionAnswerSpacePx } from "@/lib/exam/exam-answer-space";
import { getPrintableItemTagNames } from "@/lib/print/print-preview";
import type { PrintableErrorItem } from "@/types/api";
import type { PrintDisplayOptions } from "./print-options";

interface PrintableQuestionProps {
    item: PrintableErrorItem;
    index: number;
    options: PrintDisplayOptions;
    /** 不显示答案和解析时题目之间预留作答空白 */
    reserveAnswerSpace: boolean;
    /** 单题手动调整的留白高度（px） */
    customAnswerSpacePx?: number | null;
    /** 单题手动调整留白回调（null 为恢复默认）；需保持引用稳定，避免整页重渲染 */
    onCustomAnswerSpaceChange?: (id: string, px: number | null) => void;
    /** 卷别名称，由页面统一查好后传入 */
    paperGroupName?: string | null;
    /** 从打印稿中移除本题（取消勾选）；需保持引用稳定 */
    onRemove?: (id: string) => void;
}

/**
 * 打印页中的一道题：题号、来源信息、原图或文字，以及可选的答案和解析。
 * 使用 memo：勾选或调整其他题目时不重新渲染本题的公式与 Markdown。
 */
export const PrintableQuestion = memo(function PrintableQuestion({
    item,
    index,
    options,
    reserveAnswerSpace,
    customAnswerSpacePx,
    onCustomAnswerSpaceChange,
    paperGroupName,
    onRemove,
}: PrintableQuestionProps) {
    const { t } = useLanguage();
    const tags = getPrintableItemTagNames(item);
    const answerSpacePx = reserveAnswerSpace
        ? resolveQuestionAnswerSpacePx(options.answerSpace ?? "auto", item.questionText || "", customAnswerSpacePx)
        : 0;

    return (
        // content-visibility：屏幕外的题目跳过排版绘制，题目多时滚动和切换选项更流畅；打印时全部渲染
        <div className={`mb-4 border-b last:border-b-0 print:break-inside-avoid [content-visibility:auto] [contain-intrinsic-size:auto_480px] print:[content-visibility:visible] ${reserveAnswerSpace ? "pb-4" : "pb-6"}`}>
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
                {paperGroupName && (
                    <span className="text-sm text-muted-foreground">
                        {t.printPreview?.paperLevel || 'Paper Level'}: {paperGroupName}
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
                {onRemove && (
                    <button
                        type="button"
                        className="print:hidden ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive"
                        onClick={() => onRemove(item.id)}
                    >
                        <X className="h-3.5 w-3.5" />
                        {t.printPreview.removeFromPrint}
                    </button>
                )}
            </div>

            {options.showQuestionText && item.questionText ? (
                <div className="mb-4">
                    <MarkdownRenderer content={item.questionText} />
                    {/* 有 SVG 配图时打印配图，不再打印拍照原图 */}
                    <QuestionFigure svg={item.figureSvg} scale={item.figureScale} align={item.figureAlign} />
                </div>
            ) : (
                item.originalImageUrl && (
                    <div className="mb-4">
                        <img
                            src={item.originalImageUrl}
                            alt={t.detail?.originalProblem || 'Question Image'}
                            loading="lazy"
                            decoding="async"
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

            {reserveAnswerSpace && (
                <>
                    <div className="print-answer-space" style={{ minHeight: `${answerSpacePx}px` }} />
                    {onCustomAnswerSpaceChange && (
                        <AnswerSpaceControl
                            effectivePx={answerSpacePx}
                            isCustom={typeof customAnswerSpacePx === "number"}
                            onChange={(px) => onCustomAnswerSpaceChange(item.id, px)}
                            onReset={() => onCustomAnswerSpaceChange(item.id, null)}
                        />
                    )}
                </>
            )}
        </div>
    );
});
