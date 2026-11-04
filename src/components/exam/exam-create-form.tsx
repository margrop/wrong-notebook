"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TagInput } from "@/components/tag-input";
import { ExamModeToggle } from "@/components/exam/exam-mode-toggle";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { usePaperGroups } from "@/lib/hooks/use-paper-groups";
import { QUESTION_TYPES, NO_QUESTION_TYPE } from "@/lib/question/question-type";
import type { QuestionType } from "@/lib/question/question-type";
import type { ExamMode, ExamPickRule, ExamScope, Notebook } from "@/types/api";

const SCOPES: ExamScope[] = ["unmastered", "mastered", "all"];
const PICK_RULES: ExamPickRule[] = ["least_practiced", "random"];
const DIFFICULTIES = ["easy", "medium", "hard", "harder"] as const;

interface CreateExamResponse {
    id: string;
    title: string;
    requestedCount: number;
    questionCount: number;
    papers?: { id: string; title: string; questionCount: number }[];
    warning?: string;
    error?: string;
}

/** 新建试卷：选择错题本、范围、题量与难度 */
export function ExamCreateForm() {
    const { t, language } = useLanguage();
    const router = useRouter();
    const [notebooks, setNotebooks] = useState<Notebook[]>([]);
    const [subjectIds, setSubjectIds] = useState<string[]>([]);
    const [tagNames, setTagNames] = useState<string[]>([]);
    const [paperLevelIds, setPaperLevelIds] = useState<string[]>([]);
    const [questionTypes, setQuestionTypes] = useState<string[]>([]);
    const [scope, setScope] = useState<ExamScope>("unmastered");
    const [pickRule, setPickRule] = useState<ExamPickRule>("least_practiced");
    const [count, setCount] = useState(10);
    const [difficulty, setDifficulty] = useState<typeof DIFFICULTIES[number]>("medium");
    const [mode, setMode] = useState<ExamMode>("generate");
    const [title, setTitle] = useState("");
    const [parallel, setParallel] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const { groups: paperGroups, loading: groupsLoading } = usePaperGroups();

    useEffect(() => {
        apiClient.get<Notebook[]>("/api/notebooks")
            .then((data) => {
                setNotebooks(data);
                if (data.length === 1) setSubjectIds([data[0].id]);
            })
            .catch(() => setNotebooks([]));
    }, []);

    const toggleNotebook = (id: string) => {
        setSubjectIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
    };

    const togglePaperGroup = (id: string) => {
        setPaperLevelIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
    };

    const toggleQuestionType = (type: string) => {
        setQuestionTypes((prev) => (prev.includes(type) ? prev.filter((value) => value !== type) : [...prev, type]));
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (subjectIds.length === 0) {
            setError(t.exam.noNotebook);
            return;
        }
        setSubmitting(true);
        setError(null);
        setNotice(null);
        try {
            const paper = await apiClient.post<CreateExamResponse>("/api/exams", {
                subjectIds,
                tagNames,
                paperLevelIds: paperLevelIds.length > 0 ? paperLevelIds : undefined,
                questionTypes: questionTypes.length > 0
                    ? questionTypes.map((value) => (value === NO_QUESTION_TYPE ? "none" : value))
                    : undefined,
                scope,
                pickRule,
                count,
                difficulty: mode === "original" ? undefined : difficulty,
                mode,
                title: title.trim() || undefined,
                language,
                parallel: parallel || undefined,
            });
            if (paper.papers && paper.papers.length > 1) {
                // A/B 卷都创建成功，提示 B 卷已生成
                setNotice(t.exam.parallelCreated);
            } else if (paper.warning === "PARALLEL_NOT_ENOUGH") {
                // 源题不足，只创建了 A 卷
                setNotice(t.exam.parallelNotEnough);
            } else if (paper.error === "PARALLEL_B_QUOTA_EXCEEDED") {
                // 第二卷 AI 额度不足
                setNotice(t.exam.parallelQuotaExceeded);
            }
            router.push(`/exams/${paper.id}`);
        } catch (err) {
            const message = (err as { data?: { message?: string } })?.data?.message;
            setError(message === "NO_SOURCE_ITEMS" ? t.exam.noSource : t.common.messages?.saveFailed || "Failed");
            setSubmitting(false);
        }
    };

    const difficultyLabels = t.practice.difficulty as Record<string, string>;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">{t.exam.createTitle}</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label>{t.exam.notebooks}</Label>
                            {notebooks.length > 1 && (
                                <button
                                    type="button"
                                    className="text-xs text-primary hover:underline"
                                    onClick={() => setSubjectIds(subjectIds.length === notebooks.length ? [] : notebooks.map((n) => n.id))}
                                >
                                    {t.exam.selectAll}
                                </button>
                            )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {notebooks.map((notebook) => (
                                <label key={notebook.id} className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer hover:bg-muted/50">
                                    <Checkbox checked={subjectIds.includes(notebook.id)} onCheckedChange={() => toggleNotebook(notebook.id)} />
                                    <span className="truncate">{notebook.name}</span>
                                    <span className="ml-auto text-xs text-muted-foreground">{notebook._count?.errorItems ?? ""}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.exam.tags}</Label>
                        <TagInput value={tagNames} onChange={setTagNames} placeholder={t.exam.tagsPlaceholder} />
                    </div>

                    {!groupsLoading && paperGroups.filter((g) => g.isActive).length > 0 && (
                        <div className="space-y-2">
                            <Label>{t.filter.paperLevel}</Label>
                            <div className="flex flex-wrap gap-2">
                                {paperGroups.filter((g) => g.isActive).map((group) => (
                                    <button
                                        key={group.id}
                                        type="button"
                                        onClick={() => togglePaperGroup(group.id)}
                                        className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                                            paperLevelIds.includes(group.id)
                                                ? "border-primary bg-primary text-primary-foreground"
                                                : "border-input bg-background hover:bg-muted"
                                        }`}
                                    >
                                        {group.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label>{t.questionType.label}</Label>
                        <div className="flex flex-wrap gap-2">
                            {QUESTION_TYPES.map((type) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => toggleQuestionType(type)}
                                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                                        questionTypes.includes(type)
                                            ? "border-primary bg-primary text-primary-foreground"
                                            : "border-input bg-background hover:bg-muted"
                                    }`}
                                >
                                    {t.questionType.names[type as QuestionType] || type}
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={() => toggleQuestionType(NO_QUESTION_TYPE)}
                                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                                    questionTypes.includes(NO_QUESTION_TYPE)
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-input bg-background hover:bg-muted"
                                }`}
                            >
                                {t.questionType.notSet}
                            </button>
                        </div>
                        <p className="text-xs text-muted-foreground">{t.exam.questionTypesHint}</p>
                    </div>

                    <ExamModeToggle value={mode} onChange={setMode} />

                    <div className={`grid gap-4 ${mode === "generate" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                        <div className="space-y-2">
                            <Label>{t.exam.scope}</Label>
                            <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
                                {SCOPES.map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => setScope(value)}
                                        className={`rounded px-2 py-1.5 text-sm transition-colors ${scope === value ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
                                    >
                                        {t.exam.scopes[value]}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="exam-count">{t.exam.count}</Label>
                            <Input
                                id="exam-count"
                                type="number"
                                min={1}
                                max={50}
                                value={count}
                                onChange={(e) => setCount(Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                            />
                        </div>
                        {mode === "generate" && (
                            <div className="space-y-2">
                                <Label htmlFor="exam-difficulty">{t.exam.difficulty}</Label>
                                <select
                                    id="exam-difficulty"
                                    value={difficulty}
                                    onChange={(e) => setDifficulty(e.target.value as typeof DIFFICULTIES[number])}
                                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                                >
                                    {DIFFICULTIES.map((value) => (
                                        <option key={value} value={value}>{difficultyLabels[value]}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label>{t.exam.pickRule}</Label>
                        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 sm:max-w-sm">
                            {PICK_RULES.map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setPickRule(value)}
                                    className={`rounded px-2 py-1.5 text-sm transition-colors ${pickRule === value ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
                                >
                                    {t.exam.pickRules[value]}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground">{t.exam.pickRuleHints[pickRule]}</p>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-4">
                            <Label htmlFor="exam-parallel">{t.exam.parallelLabel}</Label>
                            <Switch
                                id="exam-parallel"
                                checked={parallel}
                                onCheckedChange={setParallel}
                            />
                        </div>
                        <p className="text-xs text-muted-foreground">{t.exam.parallelHint}</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="exam-title">{t.exam.titleLabel}</Label>
                        <Input id="exam-title" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}
                    {notice && <p className="text-sm text-primary">{notice}</p>}

                    <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                        {submitting ? t.exam.creating : mode === "original" ? t.exam.createOriginal : t.exam.generate}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}
