"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { ExamQuestionCard } from "@/components/exam/exam-question-card";
import { ExamScoreBar } from "@/components/exam/exam-score-bar";
import { groupExamQuestions } from "@/lib/exam/exam-sections";
import type { ExamSection, ExamSectionItem } from "@/lib/exam/exam-sections";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ExamMode, ExamQuestionDetail, PracticeResult } from "@/types/api";
import type { FigureAlign } from "@/lib/figure-scale";

interface ExamDetailQuestionsProps {
    paperId: string;
    paperMode: ExamMode;
    /** 是否按题型分大题显示 */
    groupByType: boolean;
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
    onSaveGroupByType: (groupByType: boolean) => Promise<void>;
}

/** 大题标题行：题型名 + 题数与分值小计（未全部设分值时注明未设分值题数） */
function SectionHeader({ section }: { section: ExamSection<ExamQuestionDetail> }) {
    const { t } = useLanguage();
    const summary = section.scoreTotal !== null
        ? t.exam.sectionSummaryScored
            .replace("{count}", String(section.count))
            .replace("{total}", String(section.scoreTotal))
        : t.exam.sectionSummary.replace("{count}", String(section.count));
    return (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2 pt-4">
            <h2 className="text-base font-bold">{section.title}</h2>
            <span className="text-sm text-muted-foreground">
                {summary}
                {section.scoreTotal !== null && section.unscored > 0 && (
                    <span>（{t.exam.sectionSummaryUnscored.replace("{count}", String(section.unscored))}）</span>
                )}
            </span>
        </div>
    );
}

/** 按题型分大题时的分组题目列表 */
function GroupedQuestions({
    paperId,
    paperMode,
    sections,
    draft,
    onResultChange,
    onDeleteAttempt,
    onRegenerated,
    uniformPreview,
    onSaveFigureScale,
    onSaveScore,
}: Omit<ExamDetailQuestionsProps, "groupByType" | "questions" | "onSaveUniformScore" | "onSaveGroupByType"> & {
    sections: ExamSection<ExamQuestionDetail>[];
}) {
    const renderQuestion = (item: ExamSectionItem<ExamQuestionDetail>) => (
        <ExamQuestionCard
            key={item.question.id}
            paperId={paperId}
            paperMode={paperMode}
            question={item.question}
            displayNumber={item.displayNumber}
            editingResult={draft ? draft[item.question.id] ?? null : undefined}
            onResultChange={(result) => onResultChange(item.question.id, result)}
            onDeleteAttempt={onDeleteAttempt}
            onRegenerated={onRegenerated}
            previewFigureScale={uniformPreview.scale}
            previewFigureAlign={uniformPreview.align}
            onSaveFigureScale={onSaveFigureScale}
            onSaveScore={onSaveScore}
        />
    );
    return (
        <div className="space-y-3">
            {sections.map((section) => (
                <section key={section.title} className="space-y-3">
                    <SectionHeader section={section} />
                    {section.items.map(renderQuestion)}
                </section>
            ))}
        </div>
    );
}

/** 试卷详情页的题目列表：批量分值栏、按题型分大题开关与各题卡片。 */
export function ExamDetailQuestions({
    paperId,
    paperMode,
    groupByType,
    questions,
    draft,
    onResultChange,
    onDeleteAttempt,
    onRegenerated,
    uniformPreview,
    onSaveFigureScale,
    onSaveScore,
    onSaveUniformScore,
    onSaveGroupByType,
}: ExamDetailQuestionsProps) {
    const { t, language } = useLanguage();
    const sections = groupByType
        ? groupExamQuestions(questions, language)
        : null;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <ExamScoreBar
                    scores={questions.map((question) => question.score ?? null)}
                    disabled={Boolean(draft)}
                    onSave={onSaveUniformScore}
                />
                <label className="flex items-center gap-2 text-sm" title={t.exam.groupByTypeHint}>
                    <Checkbox
                        checked={groupByType}
                        disabled={Boolean(draft)}
                        onCheckedChange={(value) => void onSaveGroupByType(value === true)}
                    />
                    {t.exam.groupByType}
                </label>
            </div>
            {sections ? (
                <GroupedQuestions
                    paperId={paperId}
                    paperMode={paperMode}
                    sections={sections}
                    draft={draft}
                    onResultChange={onResultChange}
                    onDeleteAttempt={onDeleteAttempt}
                    onRegenerated={onRegenerated}
                    uniformPreview={uniformPreview}
                    onSaveFigureScale={onSaveFigureScale}
                    onSaveScore={onSaveScore}
                />
            ) : (
                questions.map((question) => (
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
                ))
            )}
        </div>
    );
}
