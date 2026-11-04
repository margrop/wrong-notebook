"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Save, Loader2, Eye, Edit3, PenLine, RotateCcw } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { TagInput } from "@/components/tag-input";
import { NotebookSelector } from "@/components/notebook-selector";
import { PaperGroupSelect } from "@/components/paper-group-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inferSubjectFromName } from "@/lib/tags/knowledge-tags";
import type { MistakeStatus } from "@/lib/question/mistake-status";
import { toast } from "@/lib/feedback";

interface DirectTextEditorProps {
    onSubmit: (data: {
        questionText: string;
        answerText: string;
        analysis: string;
        wrongAnswerText: string;
        mistakeAnalysis: string;
        mistakeStatus: string;
        knowledgePoints: string[];
        subjectId: string;
        gradeSemester?: string;
        paperLevel?: string;
    }) => Promise<void>;
    defaultNotebookId?: string;
    defaultNotebookName?: string;
    isSaving: boolean;
}

export function DirectTextEditor({ onSubmit, defaultNotebookId, defaultNotebookName, isSaving }: DirectTextEditorProps) {
    const { t } = useLanguage();
    const [previewField, setPreviewField] = useState<string | null>(null);

    const [questionText, setQuestionText] = useState("");
    const [answerText, setAnswerText] = useState("");
    const [analysis, setAnalysis] = useState("");
    const [wrongAnswerText, setWrongAnswerText] = useState("");
    const [mistakeAnalysis, setMistakeAnalysis] = useState("");
    const [mistakeStatus, setMistakeStatus] = useState<MistakeStatus>("unknown");
    const [knowledgePoints, setKnowledgePoints] = useState<string[]>([]);
    const [subjectId, setSubjectId] = useState(defaultNotebookId || "");
    const [gradeSemester, setGradeSemester] = useState("");
    const [paperLevel, setPaperLevel] = useState("");

    const handleSubmit = async () => {
        if (!questionText.trim()) return;
        if (!subjectId) {
            toast.warning(t.editor.messages?.selectNotebook || "Please select a notebook");
            return;
        }

        await onSubmit({
            questionText: questionText.trim(),
            answerText: answerText.trim(),
            analysis: analysis.trim(),
            wrongAnswerText: wrongAnswerText.trim(),
            mistakeAnalysis: mistakeAnalysis.trim(),
            mistakeStatus,
            knowledgePoints,
            subjectId,
            gradeSemester: gradeSemester || undefined,
            paperLevel: paperLevel || undefined,
        });
    };

    const handleReset = () => {
        setQuestionText("");
        setAnswerText("");
        setAnalysis("");
        setWrongAnswerText("");
        setMistakeAnalysis("");
        setMistakeStatus("unknown");
        setKnowledgePoints([]);
        setGradeSemester("");
        setPaperLevel("");
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            if (questionText.trim() && subjectId && !isSaving) {
                handleSubmit();
            }
        }
    };

    const fields = [
        {
            key: "question",
            label: t.editor?.question || "Question Text",
            value: questionText,
            setter: setQuestionText,
            placeholder: t.directEntry.questionPlaceholder,
            minHeight: "min-h-[180px]",
            required: true,
        },
        {
            key: "answer",
            label: t.editor?.answer || "Answer",
            value: answerText,
            setter: setAnswerText,
            placeholder: t.directEntry.answerPlaceholder,
            minHeight: "min-h-[120px]",
        },
        {
            key: "analysis",
            label: t.editor?.analysis || "Analysis / Explanation",
            value: analysis,
            setter: setAnalysis,
            placeholder: t.directEntry.analysisPlaceholder,
            minHeight: "min-h-[150px]",
        },
        {
            key: "wrongAnswer",
            label: t.editor?.wrongAnswerText || "Wrong Answer / Work",
            value: wrongAnswerText,
            setter: setWrongAnswerText,
            placeholder: t.directEntry.wrongAnswerPlaceholder,
            minHeight: "min-h-[100px]",
        },
        {
            key: "mistakeAnalysis",
            label: t.editor?.mistakeAnalysis || "Mistake Cause Analysis",
            value: mistakeAnalysis,
            setter: setMistakeAnalysis,
            placeholder: t.directEntry.mistakeAnalysisPlaceholder,
            minHeight: "min-h-[100px]",
        },
    ];

    return (
        <Card className="rounded-2xl">
            <CardContent className="p-6 space-y-5">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <PenLine className="h-5 w-5" />
                        <span className="text-sm font-medium">
                            {t.directEntry.title}
                        </span>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        disabled={isSaving}
                        className="text-muted-foreground hover:text-destructive"
                    >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        {t.directEntry.reset}
                    </Button>
                </div>

                {/* Notebook & Grade Selection */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <Label>{t.editor?.selectNotebook || "Select Notebook"} *</Label>
                        <NotebookSelector
                            value={subjectId}
                            onChange={setSubjectId}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>{t.editor?.gradeSemester || "Grade/Semester"}</Label>
                        <input
                            type="text"
                            value={gradeSemester}
                            onChange={(e) => setGradeSemester(e.target.value)}
                            placeholder={t.directEntry.gradeSemesterPlaceholder}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>{t.editor?.paperLevel || "Paper Level"}</Label>
                        <PaperGroupSelect value={paperLevel} onChange={setPaperLevel} />
                    </div>
                </div>

                {/* Fields with edit/preview toggle */}
                {fields.map((field) => (
                    <div key={field.key} className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className={field.required ? "text-primary font-semibold" : ""}>
                                {field.label} {field.required && "*"}
                            </Label>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setPreviewField(previewField === field.key ? null : field.key)}
                                disabled={!field.value}
                            >
                                {previewField === field.key ? (
                                    <>
                                        <Edit3 className="h-3 w-3 mr-1" />
                                        {t.directEntry.edit}
                                    </>
                                ) : (
                                    <>
                                        <Eye className="h-3 w-3 mr-1" />
                                        {t.directEntry.preview}
                                    </>
                                )}
                            </Button>
                        </div>
                        {previewField === field.key ? (
                            <div
                                className={`rounded-md border bg-muted/30 p-4 ${field.minHeight} overflow-auto cursor-pointer`}
                                onClick={() => setPreviewField(null)}
                            >
                                <MarkdownRenderer content={field.value} />
                            </div>
                        ) : (
                            <Textarea
                                value={field.value}
                                onChange={(e) => field.setter(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={field.placeholder}
                                className={`${field.minHeight} font-mono text-sm resize-y`}
                                disabled={isSaving}
                            />
                        )}
                    </div>
                ))}

                {/* Mistake Status */}
                <div className="space-y-2">
                    <Label>{t.editor?.mistakeStatus || "Attempt Status"}</Label>
                    <Select
                        value={mistakeStatus}
                        onValueChange={(val) => setMistakeStatus(val as MistakeStatus)}
                    >
                        <SelectTrigger className="w-[200px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="not_attempted">{t.editor?.mistakeStatuses?.notAttempted || "Not attempted"}</SelectItem>
                            <SelectItem value="wrong_attempt">{t.editor?.mistakeStatuses?.wrongAttempt || "Wrong attempt"}</SelectItem>
                            <SelectItem value="unknown">{t.editor?.mistakeStatuses?.unknown || "Unknown"}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Knowledge Tags */}
                <div className="space-y-2">
                    <Label>{t.editor?.tags || "Knowledge Points (Press Enter to add)"}</Label>
                    <TagInput
                        value={knowledgePoints}
                        onChange={setKnowledgePoints}
                        placeholder={t.editor?.tagsPlaceholder || "Enter knowledge tags, select from suggestions..."}
                        enterHint={t.editor?.createTagHint}
                        subject={inferSubjectFromName(defaultNotebookName || null) || undefined}
                    />
                    <p className="text-xs text-muted-foreground">
                        {t.editor?.tagsHint || "💡 Tag suggestions will appear as you type"}
                    </p>
                </div>

                {/* Submit Button */}
                <div className="flex flex-col items-center gap-2 pt-2">
                    <Button
                        onClick={handleSubmit}
                        disabled={!questionText.trim() || !subjectId || isSaving}
                        className="w-full bg-gradient-to-r from-indigo-600 to-violet-500 hover:from-indigo-700 hover:to-violet-600 text-white font-medium"
                        size="lg"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                {t.directEntry.saving}
                            </>
                        ) : (
                            <>
                                <Save className="mr-2 h-4 w-4" />
                                {t.directEntry.save}
                            </>
                        )}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                        {t.directEntry.hint}
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
