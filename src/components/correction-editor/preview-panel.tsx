"use client";

import type { ReactNode } from "react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { QuestionFigure } from "@/components/question-figure";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import type { CorrectionDraft } from "./types";

interface PreviewPanelProps {
    data: CorrectionDraft;
    /** 显示在题目预览之后（GeoGebra 演示） */
    children?: ReactNode;
}

function PreviewCard({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent className={className}>{children}</CardContent>
        </Card>
    );
}

/** 校对页右侧：题目、答案、解析与错因分析的渲染预览 */
export function PreviewPanel({ data, children }: PreviewPanelProps) {
    const { t } = useLanguage();
    const statusLabels = {
        wrong_attempt: t.editor.mistakeStatuses?.wrongAttempt || "Wrong attempt",
        not_attempted: t.editor.mistakeStatuses?.notAttempted || "Not attempted",
        unknown: t.editor.mistakeStatuses?.unknown || "Unknown",
    };

    return (
        <div className="space-y-6">
            <PreviewCard title={t.editor.preview?.question || "Question Preview"}>
                <MarkdownRenderer content={data.questionText} />
                <QuestionFigure svg={data.figureSvg} />
            </PreviewCard>

            {children}

            <PreviewCard title={t.editor.preview?.answer || "Answer Preview"}>
                <MarkdownRenderer content={data.answerText} />
            </PreviewCard>

            <PreviewCard title={t.editor.preview?.analysis || "Analysis Preview"}>
                <MarkdownRenderer content={data.analysis} />
            </PreviewCard>

            <PreviewCard title={t.editor.preview?.mistakeAnalysis || "Mistake Analysis Preview"} className="space-y-3 text-sm">
                <div className="text-muted-foreground">
                    {t.editor.mistakeStatus || "Attempt Status"}{t.common.colon}{statusLabels[data.mistakeStatus as keyof typeof statusLabels] ?? statusLabels.unknown}
                </div>
                {data.wrongAnswerText && (
                    <div>
                        <div className="font-medium mb-1">{t.editor.wrongAnswerText || "Wrong Answer / Work"}</div>
                        <MarkdownRenderer content={data.wrongAnswerText} />
                    </div>
                )}
                {data.mistakeAnalysis && (
                    <div>
                        <div className="font-medium mb-1">{t.editor.mistakeAnalysis || "Mistake Cause Analysis"}</div>
                        <MarkdownRenderer content={data.mistakeAnalysis} />
                    </div>
                )}
            </PreviewCard>
        </div>
    );
}
