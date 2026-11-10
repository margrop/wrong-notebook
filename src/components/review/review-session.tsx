"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Eye, Loader2, SkipForward, XCircle } from "lucide-react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { QuestionFigure } from "@/components/question-figure";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants/pagination";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import type { DueReviewItem, PaginatedResponse, PracticeResult } from "@/types/api";

interface ReviewSessionProps {
    /** 结束顺序复习并回到列表 */
    onClose: () => void;
}

/**
 * 按顺序复习：逐题显示到期错题，用户对照答案后标记做对或做错。
 * 做对直接标记为已掌握；做错要求填写错因，随作答记录保存。
 */
export function ReviewSession({ onClose }: ReviewSessionProps) {
    const { t } = useLanguage();
    const [items, setItems] = useState<DueReviewItem[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [index, setIndex] = useState(0);
    const [revealed, setRevealed] = useState(false);
    const [wrongMode, setWrongMode] = useState(false);
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [completed, setCompleted] = useState(false);

    // 顺序模式读取全部到期错题，跨分页保持最早到期的在前
    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const all: DueReviewItem[] = [];
            for (let page = 1; ; page += 1) {
                const response = await apiClient.get<PaginatedResponse<DueReviewItem>>(
                    `/api/review/due?page=${page}&pageSize=${DEFAULT_PAGE_SIZE}`,
                );
                all.push(...response.items);
                if (response.items.length === 0 || page >= response.totalPages) break;
            }
            setItems(all);
            setIndex(0);
            setCompleted(all.length === 0);
        } catch (error) {
            frontendLogger.error('[ReviewSession]', 'Failed to load due reviews', { error });
            setLoadError(t.review.sessionLoadFailed);
        } finally {
            setLoading(false);
        }
    }, [t.review.sessionLoadFailed]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入顺序模式时加载全部到期错题
        void load();
    }, [load]);

    const resetQuestion = () => {
        setRevealed(false);
        setWrongMode(false);
        setReason("");
        setSaveError(null);
    };

    const goNext = (currentIndex: number) => {
        resetQuestion();
        if (!items || currentIndex + 1 >= items.length) setCompleted(true);
        else setIndex(currentIndex + 1);
    };

    const record = async (result: PracticeResult, mistakeAnalysis?: string) => {
        const item = items?.[index];
        if (!item) return;
        setSaving(true);
        setSaveError(null);
        try {
            await apiClient.post("/api/practice/record", {
                errorItemId: item.id,
                result,
                source: "review",
                ...(mistakeAnalysis ? { mistakeAnalysis } : {}),
            });
            toast.success(result === "correct" ? t.review.sessionCorrectSaved : t.review.sessionWrongSaved);
            goNext(index);
        } catch (error) {
            frontendLogger.error('[ReviewSession]', 'Failed to save review result', { error });
            setSaveError(t.review.sessionSaveFailed);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (loadError) {
        return (
            <Card className="border-destructive/30">
                <CardContent className="pt-6 space-y-3 text-center">
                    <p className="text-sm text-destructive">{loadError}</p>
                    <Button variant="outline" onClick={() => void load()}>{t.review.sessionRetry}</Button>
                </CardContent>
            </Card>
        );
    }

    if (!items || completed) {
        return (
            <Card className="border-green-500">
                <CardContent className="pt-6 space-y-3 text-center">
                    <CheckCircle className="mx-auto h-10 w-10 text-green-600" />
                    <h2 className="text-xl font-bold">{t.review.sessionCompleted}</h2>
                    <p className="text-sm text-muted-foreground">{t.review.sessionCompletedHint}</p>
                    <Button onClick={onClose}>{t.review.sessionBack}</Button>
                </CardContent>
            </Card>
        );
    }

    const item = items[index];
    const progress = t.review.sessionProgress
        .replace("{current}", String(index + 1))
        .replace("{total}", String(items.length));

    return (
        <Card className="border-primary/40">
            <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                    <span>{t.review.sessionTitle}</span>
                    <span className="text-sm font-normal text-muted-foreground">{progress}</span>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <MarkdownRenderer content={item.questionText} className="font-medium" />
                    <QuestionFigure svg={item.figureSvg} scale={item.figureScale} align={item.figureAlign} />
                    {!item.questionText && item.originalImageUrl && (
                        <img
                            src={item.originalImageUrl}
                            alt={t.detail.originalProblem || "Original Problem"}
                            className="mx-auto max-h-96 max-w-full rounded border bg-white object-contain"
                        />
                    )}
                    {!item.questionText && !item.originalImageUrl && (
                        <p className="text-sm text-muted-foreground italic">{t.review.sessionNoQuestion}</p>
                    )}
                </div>

                {!revealed ? (
                    <div className="flex justify-center">
                        <Button variant="outline" onClick={() => setRevealed(true)}>
                            <Eye className="mr-2 h-4 w-4" />
                            {t.review.sessionReveal}
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="rounded-lg border bg-muted/40 p-4">
                            <h4 className="mb-1 font-semibold text-green-600">{t.practice.correctAnswer}</h4>
                            <MarkdownRenderer content={item.answerText} className="font-semibold" />
                        </div>
                        {item.analysis && (
                            <div className="rounded-lg border p-4">
                                <h4 className="mb-1 font-semibold">{t.practice.detailedAnalysis}</h4>
                                <MarkdownRenderer content={item.analysis} />
                            </div>
                        )}
                        <div className="flex flex-col justify-center gap-2 sm:flex-row">
                            <Button
                                onClick={() => void record("correct")}
                                disabled={saving}
                                className="bg-green-600 hover:bg-green-700"
                            >
                                <CheckCircle className="mr-2 h-4 w-4" />
                                {t.review.sessionCorrect}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => setWrongMode(true)}
                                disabled={saving}
                                className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                            >
                                <XCircle className="mr-2 h-4 w-4" />
                                {t.review.sessionWrong}
                            </Button>
                        </div>
                        {wrongMode && (
                            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                                <label htmlFor="review-wrong-reason" className="text-sm font-medium">
                                    {t.review.sessionReason}
                                </label>
                                <Textarea
                                    id="review-wrong-reason"
                                    value={reason}
                                    onChange={(event) => setReason(event.target.value)}
                                    placeholder={t.review.sessionReasonPlaceholder}
                                    rows={3}
                                    disabled={saving}
                                />
                                <Button
                                    onClick={() => void record("wrong", reason.trim())}
                                    disabled={saving || !reason.trim()}
                                >
                                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    {t.review.sessionSaveWrong}
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                {saveError && <p className="text-sm text-destructive">{saveError}</p>}

                <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => goNext(index)} disabled={saving}>
                        <SkipForward className="mr-1.5 h-3.5 w-3.5" />
                        {t.review.sessionSkip}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
