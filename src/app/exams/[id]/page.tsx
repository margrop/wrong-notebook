"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { answeredDateToISOString, formatDateTime } from "@/lib/date-time";
import { ClipboardCheck, Loader2, Printer, RotateCcw, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BackButton } from "@/components/ui/back-button";
import { PageLoading } from "@/components/ui/page-loading";
import { ExamFigureScaleBar } from "@/components/exam/exam-figure-scale-bar";
import { ExamStatusBadge } from "@/components/exam/exam-status-badge";
import { ExamDetailQuestions } from "./exam-detail-questions";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/lib/page-title";
import { apiClient, ApiError } from "@/lib/api-client";
import { useRunningTask } from "@/lib/hooks/use-running-task";
import { formatExamScore, summarizeExamScores } from "@/lib/exam/exam-score";
import type { FigureAlign } from "@/lib/figure-scale";
import type { ExamPaperDetail, PracticeResult } from "@/types/api";
import { confirmDialog, toast } from "@/lib/feedback";

const POLL_INTERVAL_MS = 3000;

export default function ExamDetailPage() {
    const { timeZone } = useTimeZone();
    const params = useParams();
    const router = useRouter();
    const { t, language } = useLanguage();
    const paperId = params.id as string;
    const [paper, setPaper] = useState<ExamPaperDetail | null>(null);
    usePageTitle(t.exam.title, paper?.title);
    const [notFound, setNotFound] = useState(false);
    // 录入模式下各题的待保存结果；null 表示未在录入
    const [draft, setDraft] = useState<Record<string, PracticeResult | null> | null>(null);
    const [takenAt, setTakenAt] = useState(formatDateTime(new Date(), "yyyy-MM-dd", timeZone));
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [uniformPreview, setUniformPreview] = useState<{ scale: number | null; align: FigureAlign | null }>({ scale: null, align: null });

    // 重试失败题目：同一试卷同一时刻只允许一个生成任务；刷新后若任务仍在进行，禁用按钮
    const retryTarget = `exam-paper:${paperId}:generate`;
    const { running: retryRunning, refresh: refreshRetryTask } = useRunningTask(retryTarget);

    const load = useCallback(async () => {
        try {
            setPaper(await apiClient.get<ExamPaperDetail>(`/api/exams/${paperId}`));
        } catch {
            setNotFound(true);
        }
    }, [paperId]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面或条件变化时加载，请求前后更新加载状态和结果
        load();
    }, [load]);

    // 生成中时轮询进度
    useEffect(() => {
        if (paper?.status !== "generating") return;
        const timer = setTimeout(load, POLL_INTERVAL_MS);
        return () => clearTimeout(timer);
    }, [paper, load]);

    if (notFound) return <div className="p-8 text-center">{t.exam.notFound}</div>;
    if (!paper) return <PageLoading label={t.common.loading} />;

    const readyCount = paper.questions.filter((question) => question.status === "ready").length;
    const recorded = paper.questions.some((question) => question.attempts.length > 0);
    const hasFailed = paper.questions.some((question) => question.status === "failed");
    const recordable = paper.questions.filter((question) => question.status === "ready" && question.errorItemId);
    const figureQuestions = paper.questions.filter((question) => question.status === "ready" && Boolean(question.figureSvg));

    const selectedCount = draft ? recordable.filter((question) => draft[question.id]).length : 0;

    // 每次录入都是新的一次作答，从空白开始
    const startRecording = () => {
        setMessage(null);
        setDraft({});
        setTakenAt(formatDateTime(new Date(), "yyyy-MM-dd", timeZone));
    };

    const saveResults = async () => {
        if (!draft || selectedCount === 0) return;
        setSaving(true);
        setMessage(null);
        try {
            await apiClient.post(`/api/exams/${paper.id}/results`, {
                takenAt: answeredDateToISOString(takenAt, timeZone),
                results: recordable
                    .filter((question) => draft[question.id])
                    .map((question) => ({ questionId: question.id, result: draft[question.id] })),
            });
            setDraft(null);
            setMessage(t.exam.resultsSaved);
            await load();
        } catch {
            setMessage(t.exam.resultsSaveFailed);
        } finally {
            setSaving(false);
        }
    };

    const deleteAttempt = async (attemptId: string) => {
        if (!(await confirmDialog(t.mastery.deleteRecordConfirm, { destructive: true }))) return;
        try {
            await apiClient.delete(`/api/practice/record/${attemptId}`);
            await load();
        } catch {
            setMessage(t.mastery.deleteRecordFailed);
        }
    };

    const retryFailed = async () => {
        try {
            await apiClient.post(`/api/exams/${paper.id}/retry`, { language });
        } catch (error) {
            if (error instanceof ApiError && error.status === 409 && (error.data as { code?: string })?.code === "TASK_ALREADY_RUNNING") {
                toast.info(t.errors.TASK_ALREADY_RUNNING);
                await refreshRetryTask();
            } else {
                throw error;
            }
        }
        await load();
    };

    const deletePaper = async () => {
        if (!(await confirmDialog(t.exam.deleteConfirm, { destructive: true }))) return;
        await apiClient.delete(`/api/exams/${paper.id}`);
        router.push("/exams");
    };

    const saveQuestionFigureScale = async (questionId: string, figureScale: number, figureAlign: FigureAlign) => {
        await apiClient.patch(`/api/exams/${paper.id}`, { questionId, figureScale, figureAlign });
        setPaper((prev) => (prev ? {
            ...prev,
            questions: prev.questions.map((question) => (question.id === questionId ? { ...question, figureScale, figureAlign } : question)),
        } : prev));
    };

    const saveUniformFigureScale = async (patch: { figureScale?: number; figureAlign?: FigureAlign }) => {
        await apiClient.patch(`/api/exams/${paper.id}`, patch);
        setPaper((prev) => (prev ? {
            ...prev,
            questions: prev.questions.map((question) => ({ ...question, ...patch })),
        } : prev));
    };

    const saveQuestionScore = async (questionId: string, score: number | null) => {
        await apiClient.patch(`/api/exams/${paper.id}`, { questionId, score });
        setPaper((prev) => (prev ? {
            ...prev,
            questions: prev.questions.map((question) => (question.id === questionId ? { ...question, score } : question)),
        } : prev));
    };

    const saveUniformScore = async (score: number | null) => {
        await apiClient.patch(`/api/exams/${paper.id}`, { score });
        setPaper((prev) => (prev ? {
            ...prev,
            questions: prev.questions.map((question) => ({ ...question, score })),
        } : prev));
    };

    const saveGroupByType = async (groupByType: boolean) => {
        await apiClient.patch(`/api/exams/${paper.id}`, { groupByType });
        setPaper((prev) => (prev ? { ...prev, groupByType } : prev));
    };

    const readyScoreSummary = summarizeExamScores(
        paper.questions.filter((question) => question.status === "ready").map((question) => question.score ?? null)
    );

    return (
        <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 md:px-8 md:py-8">
            <div className="space-y-6 pb-24">
                <div className="flex items-start gap-3">
                    <BackButton fallbackUrl="/exams" className="-ml-2 shrink-0" />
                    <div className="flex-1 min-w-0 space-y-2">
                        <h1 className="text-xl sm:text-2xl font-bold tracking-tight break-words">{paper.title}</h1>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            <ExamStatusBadge status={paper.status} recorded={recorded} />
                            {paper.mode === 'original' && <Badge variant="secondary">{t.exam.modes.original}</Badge>}
                            <span>{t.exam.progress.replace("{ready}", String(readyCount)).replace("{total}", String(paper.questions.length))}</span>
                            {readyScoreSummary.total !== null && (
                                <span>
                                    {t.exam.totalScore.replace("{total}", formatExamScore(readyScoreSummary.total))}
                                    {readyScoreSummary.unscored > 0 && (
                                        <span className="text-xs">（{t.exam.totalScoreUnscored.replace("{count}", String(readyScoreSummary.unscored))}）</span>
                                    )}
                                </span>
                            )}
                            <span>{formatDateTime(paper.createdAt, "yyyy-MM-dd HH:mm", timeZone)}</span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    <Link href={`/exams/${paper.id}/print`}>
                        <Button variant="outline" size="sm" disabled={readyCount === 0}>
                            <Printer className="mr-2 h-4 w-4" />
                            {t.exam.print}
                        </Button>
                    </Link>
                    {!draft && recordable.length > 0 && (
                        <Button size="sm" onClick={startRecording}>
                            <ClipboardCheck className="mr-2 h-4 w-4" />
                            {t.exam.recordResults}
                        </Button>
                    )}
                    {hasFailed && paper.status !== "generating" && (
                        <Button variant="outline" size="sm" onClick={retryFailed} disabled={!!retryRunning}>
                            {retryRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                            {retryRunning ? t.exam.questionPending : t.exam.retryFailed}
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={deletePaper} className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 sm:ml-auto">
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t.exam.delete}
                    </Button>
                </div>

                {paper.questions.length < paper.requestedCount && (
                    <p className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-200">
                        {t.exam.fewerThanRequested.replaceAll("{actual}", String(paper.questions.length))}
                    </p>
                )}
                {message && <p className="rounded-md border p-3 text-sm">{message}</p>}

                {draft && (
                    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                            <label htmlFor="exam-taken-at" className="text-sm font-medium">{t.exam.takenAt}</label>
                            <Input id="exam-taken-at" type="date" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} className="sm:w-48" />
                        </div>
                        <p className="text-xs text-muted-foreground">{t.exam.recordHint}</p>
                    </div>
                )}

                {figureQuestions.length > 0 && (
                    <ExamFigureScaleBar
                        scales={figureQuestions.map((question) => question.figureScale)}
                        aligns={figureQuestions.map((question) => question.figureAlign)}
                        onPreviewChange={setUniformPreview}
                        onSave={saveUniformFigureScale}
                    />
                )}

                <ExamDetailQuestions
                    paperId={paper.id}
                    paperMode={paper.mode}
                    groupByType={paper.groupByType}
                    questions={paper.questions}
                    draft={draft}
                    onResultChange={(questionId, result) => setDraft((prev) => (prev ? { ...prev, [questionId]: result } : prev))}
                    onDeleteAttempt={deleteAttempt}
                    onRegenerated={load}
                    uniformPreview={uniformPreview}
                    onSaveFigureScale={saveQuestionFigureScale}
                    onSaveScore={saveQuestionScore}
                    onSaveUniformScore={saveUniformScore}
                    onSaveGroupByType={saveGroupByType}
                />

                {draft && (
                    <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-background/95 p-3 backdrop-blur md:bottom-0">
                        <div className="max-w-4xl mx-auto flex items-center justify-end gap-2">
                            {selectedCount === 0 && <span className="mr-auto text-xs text-muted-foreground">{t.exam.noResultSelected}</span>}
                            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>{t.exam.cancel}</Button>
                            <Button onClick={saveResults} disabled={saving || !takenAt || selectedCount === 0}>
                                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                {t.exam.saveResults}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}
