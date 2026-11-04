"use client";

import { ExamQuestionCard } from "@/components/exam/exam-question-card";
import { ExamScoreBar } from "@/components/exam/exam-score-bar";
import type { ExamMode, ExamQuestionDetail, PracticeResult } from "@/types/api";
import type { FigureAlign } from "@/lib/figure-scale";

interface ExamDetailQuestionsProps {
    paperId: string;
    paperMode: ExamMode;
    questions: ExamQuestionDetail[];
    /** 录入模式下的待保存结果；null 表示非录入模式 */
    draft: Record<string, PracticeResult | null> | null;
    onResultChange: (questionId: string, result: PracticeResult) => void;
    onDeleteAttempt: (attemptId: string) => void;
    onRegenerated: () => void;
    uniformPreview: { scale: number | null; align: FigureAlign | null };
    onSaveFigureScale: (questionId: string, figureScale: number, figureAlign: FigureAlign) => Promise<void>;
    onSaveScore: (questionId: string, score: number | null) => Promise<void>;
    onSaveUniformScore: (score: number | null) => Promise<void>;
}

/** 试卷详情页的题目列表：批量分值栏 + 各题卡片。 */
export function ExamDetailQuestions({
    paperId,
    paperMode,
    questions,
    draft,
    onResultChange,
    onDeleteAttempt,
    onRegenerated,
    uniformPreview,
    onSaveFigureScale,
    onSaveScore,
    onSaveUniformScore,
}: ExamDetailQuestionsProps) {
    return (
        <div className="space-y-3">
            <ExamScoreBar
                scores={questions.map((question) => question.score ?? null)}
                disabled={Boolean(draft)}
                onSave={onSaveUniformScore}
            />
            {questions.map((question) => (
                <ExamQuestionCard
                    key={question.id}
                    paperId={paperId}
                    paperMode={paperMode}
                    question={question}
                    editingResult={draft ? draft[question.id] ?? null : undefined}
                    onResultChange={(result) => onResultChange(question.id, result)}
                    onDeleteAttempt={onDeleteAttempt}
                    onRegenerated={onRegenerated}
                    previewFigureScale={uniformPreview.scale}
                    previewFigureAlign={uniformPreview.align}
                    onSaveFigureScale={onSaveFigureScale}
                    onSaveScore={onSaveScore}
                />
            ))}
        </div>
    );
}
