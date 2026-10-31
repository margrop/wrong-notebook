"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { formatDateTime } from "@/lib/date-time";
import { ChevronDown, ChevronUp, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { PracticeRecordForm } from "@/components/practice-record-form";
import { QuestionFigure } from "@/components/question-figure";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { toast, confirmDialog } from "@/lib/feedback";
import { isMastered } from "@/lib/mastery-status";
import type { MasteryStatus } from "@/lib/mastery-status";
import type { PracticeHistoryResponse } from "@/types/api";

interface MasteryPanelProps {
    errorItemId: string;
    /** 复习状态加载或被后台评估更新后回调，用于同步页面上的状态标签 */
    onMasteryStatusChange?: (status: MasteryStatus) => void;
}

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 20;

export const RESULT_BADGE_CLASS: Record<string, string> = {
    correct: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900",
    wrong: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900",
    not_attempted: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900",
};

export function MasteryPanel({ errorItemId, onMasteryStatusChange }: MasteryPanelProps) {
    const { timeZone } = useTimeZone();
    const { t } = useLanguage();
    const [data, setData] = useState<PracticeHistoryResponse | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [polls, setPolls] = useState(0);
    const [adding, setAdding] = useState(false);

    const load = useCallback(() => {
        apiClient.get<PracticeHistoryResponse>(`/api/error-items/${errorItemId}/practice-records`)
            .then((result) => {
                setData(result);
                onMasteryStatusChange?.(result.masteryStatus);
            })
            // 记录加载失败不影响详情页其他内容
            .catch(() => undefined);
    }, [errorItemId, onMasteryStatusChange]);

    useEffect(load, [load]);

    // 新增或删除记录后重新加载，并重新开始等待后台评估
    const reload = () => {
        setPolls(0);
        load();
    };

    const deleteRecord = async (recordId: string) => {
        if (!(await confirmDialog(t.mastery.deleteRecordConfirm, { destructive: true }))) return;
        try {
            await apiClient.delete(`/api/practice/record/${recordId}`);
            reload();
        } catch {
            toast.error(t.mastery.deleteRecordFailed);
        }
    };

    const latest = data?.records[0];
    const isPending = !!latest && (!data?.masteryEvaluatedAt || new Date(latest.createdAt) > new Date(data.masteryEvaluatedAt));

    // 有新记录尚未评估时轮询，直到后台评估完成
    useEffect(() => {
        if (!isPending || polls >= MAX_POLLS) return;
        const timer = setTimeout(() => {
            setPolls((count) => count + 1);
            load();
        }, POLL_INTERVAL_MS);
        return () => clearTimeout(timer);
    }, [isPending, polls, load]);

    if (!data) return null;

    const probability = data.masteryProbability;
    const percent = probability === null ? null : Math.round(probability * 100);
    const barColor = percent === null ? "" : isMastered(probability, data.masteryThreshold) ? "bg-green-500" : percent >= 30 ? "bg-amber-500" : "bg-red-500";
    const difficultyLabels = t.practice.difficulty as Record<string, string>;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 text-primary" />
                    {t.mastery.probability}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {percent === null ? (
                    <p className="text-sm text-muted-foreground">{isPending ? t.mastery.pending : t.mastery.notEvaluated}</p>
                ) : (
                    <div className="space-y-2">
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="text-3xl font-bold">{percent}%</span>
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                                <Badge variant="outline">{data.masterySource === "ai" ? t.mastery.aiEvaluated : t.mastery.estimated}</Badge>
                            </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                            <div className={`h-full ${barColor} transition-all`} style={{ width: `${percent}%` }} />
                        </div>
                        {data.masteryReason && <p className="text-sm text-muted-foreground">{data.masteryReason}</p>}
                        <p className="text-xs text-muted-foreground">{t.mastery.thresholdHint.replace("{threshold}", String(data.masteryThreshold))}</p>
                    </div>
                )}

                <div className="space-y-2 border-t pt-4">
                    <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold">{t.mastery.history}</h4>
                        {!adding && (
                            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                                <Plus className="mr-1 h-4 w-4" />
                                {t.mastery.addRecord}
                            </Button>
                        )}
                    </div>
                    {adding && (
                        <PracticeRecordForm
                            errorItemId={errorItemId}
                            onCancel={() => setAdding(false)}
                            onSaved={() => {
                                setAdding(false);
                                reload();
                            }}
                        />
                    )}
                    {data.records.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">{t.mastery.noHistory}</p>
                    ) : (
                        <ul className="divide-y rounded-md border">
                            {data.records.map((record) => (
                                <li key={record.id} className="p-3 text-sm space-y-2">
                                    <div className="flex items-start gap-2">
                                        <button
                                            type="button"
                                            className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left"
                                            onClick={() => setExpanded(expanded === record.id ? null : record.id)}
                                        >
                                            <span className="text-muted-foreground tabular-nums">{formatDateTime(record.createdAt, "yyyy-MM-dd HH:mm", timeZone)}</span>
                                            <Badge variant="outline" className={RESULT_BADGE_CLASS[record.result] || ""}>
                                                {t.mastery.results[record.result as keyof typeof t.mastery.results] || record.result}
                                            </Badge>
                                            {record.difficulty && <Badge variant="secondary">{difficultyLabels[record.difficulty] || record.difficulty}</Badge>}
                                            <span className="text-xs text-muted-foreground">
                                                {record.exam ? `${t.mastery.sources.exam} · ${record.exam.title}` : t.mastery.sources[record.source as keyof typeof t.mastery.sources] || t.mastery.sources.practice}
                                            </span>
                                            {record.questionText && (
                                                <span className="ml-auto text-muted-foreground">
                                                    {expanded === record.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                </span>
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={t.mastery.deleteRecord}
                                            title={t.mastery.deleteRecord}
                                            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400"
                                            onClick={() => deleteRecord(record.id)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                    {expanded === record.id && record.questionText && (
                                        <div className="space-y-2 rounded-md bg-muted/40 p-3">
                                            <MarkdownRenderer content={record.questionText} />
                                            <QuestionFigure svg={record.figureSvg} />
                                            {record.wrongAnswerText && (
                                                <div className="border-t pt-2">
                                                    <p className="mb-1 font-medium">{t.editor.wrongAnswerText}</p>
                                                    <MarkdownRenderer content={record.wrongAnswerText} />
                                                </div>
                                            )}
                                            {record.mistakeAnalysis && (
                                                <div className="border-t pt-2">
                                                    <p className="mb-1 font-medium">{t.editor.mistakeAnalysis}</p>
                                                    <MarkdownRenderer content={record.mistakeAnalysis} />
                                                </div>
                                            )}
                                            {record.originalImageUrl && (
                                                // 作答图片可能来自上传的数据 URL，按原始比例显示。
                                                <img src={record.originalImageUrl} alt={t.editor.wrongAnswerText} className="max-h-96 max-w-full rounded object-contain" />
                                            )}
                                            {record.answerText && (
                                                <div className="border-t pt-2">
                                                    <MarkdownRenderer content={record.answerText} className="font-semibold" />
                                                </div>
                                            )}
                                            {record.exam && (
                                                <Link href={`/exams/${record.exam.paperId}`} className="text-xs text-primary hover:underline">
                                                    {record.exam.title}
                                                </Link>
                                            )}
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
