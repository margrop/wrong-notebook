"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { confirmDialog, toast } from "@/lib/feedback";
import { getApiErrorMessage } from "@/lib/error-message";
import { frontendLogger } from "@/lib/frontend-logger";
import { GRADE_NAMES } from "@/lib/grade-options";
import { BankQuestionCard } from "@/components/banks/bank-question-card";
import type { QuestionBankDetail } from "@/lib/question-bank/types";
import type { Notebook } from "@/types/api";

interface BankDetailProps {
    bankId: string;
    notebooks: Notebook[];
    onChanged: () => void;
    onDeleted: () => void;
}

const PAGE_SIZE = 20;

/** 真题库详情：重命名、删除、按年级/知识点检索题目，单题加入错题或删除 */
export function BankDetail({ bankId, notebooks, onChanged, onDeleted }: BankDetailProps) {
    const { t } = useLanguage();
    const [detail, setDetail] = useState<QuestionBankDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [q, setQ] = useState("");
    const [tag, setTag] = useState("");
    const [grade, setGrade] = useState("");
    const [renaming, setRenaming] = useState(false);
    const [name, setName] = useState("");

    const fetchPage = useCallback(async (page: number, append = false) => {
        if (page === 1) setLoading(true);
        else setLoadingMore(true);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
            if (q.trim()) params.set("q", q.trim());
            if (tag.trim()) params.set("tag", tag.trim());
            if (grade) params.set("grade", grade);
            const data = await apiClient.get<QuestionBankDetail>(`/api/question-banks/${bankId}?${params.toString()}`);
            setDetail((current) => append && current
                ? { ...data, questions: [...current.questions, ...data.questions] }
                : data);
            setName(data.name);
        } catch (err) {
            frontendLogger.error('[Banks]', 'Failed to load bank detail', { error: err });
            toast.error(getApiErrorMessage(err) || t.banks.sharedFailed);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [bankId, q, tag, grade, t.banks.sharedFailed]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：选中题库后读取第一页
        void fetchPage(1);
    }, [bankId, fetchPage]);

    const grades = (() => {
        try {
            const parsed: unknown = JSON.parse(detail?.gradeRange || "[]");
            return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number" && value >= 1 && value <= 12) : [];
        } catch {
            return [];
        }
    })();

    const handleSearch = () => {
        void fetchPage(1);
    };

    const handleRename = async () => {
        if (!name.trim()) return;
        try {
            await apiClient.patch(`/api/question-banks/${bankId}`, { name: name.trim() });
            setRenaming(false);
            toast.success(t.banks.renameDialog.rename);
            await fetchPage(1);
            onChanged();
        } catch (err) {
            toast.error(getApiErrorMessage(err) || t.banks.renameDialog.renaming);
        }
    };

    const handleDeleteBank = async () => {
        if (!await confirmDialog(t.banks.deleteBankConfirm)) return;
        try {
            await apiClient.delete(`/api/question-banks/${bankId}`);
            onDeleted();
            onChanged();
        } catch (err) {
            toast.error(getApiErrorMessage(err) || t.banks.deleteBank);
        }
    };

    if (loading && !detail) {
        return (
            <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (!detail) return null;

    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="min-w-0 space-y-1">
                    <CardTitle className="truncate">{detail.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                        {t.banks.questions}: {detail.questionCount} · {detail.license ?? ""}
                        {detail.source ? ` · ${detail.source}` : ""}
                    </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setRenaming((value) => !value)}>
                        <Pencil className="mr-1 h-4 w-4" />
                        {t.banks.renameBank}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={handleDeleteBank}>
                        <Trash2 className="mr-1 h-4 w-4" />
                        {t.banks.deleteBank}
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {renaming && (
                    <div className="flex flex-wrap items-end gap-2">
                        <label className="min-w-0 flex-1 space-y-1 text-sm">
                            <span className="font-medium">{t.banks.renameDialog.nameLabel}</span>
                            <input
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                placeholder={t.banks.renameDialog.placeholder}
                                maxLength={200}
                                className="w-full rounded-md border border-border bg-background px-3 py-2"
                            />
                        </label>
                        <Button type="button" size="sm" onClick={handleRename}>{t.banks.renameDialog.rename}</Button>
                    </div>
                )}

                <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-0 flex-1 space-y-1 text-sm">
                        <span className="font-medium">{t.banks.searchPlaceholder}</span>
                        <input
                            value={q}
                            onChange={(event) => setQ(event.target.value)}
                            onKeyDown={(event) => { if (event.key === "Enter") handleSearch(); }}
                            placeholder={t.banks.searchPlaceholder}
                            className="w-full rounded-md border border-border bg-background px-3 py-2"
                        />
                    </label>
                    <label className="space-y-1 text-sm">
                        <span className="font-medium">{t.banks.tagPlaceholder}</span>
                        <input
                            value={tag}
                            onChange={(event) => setTag(event.target.value)}
                            onKeyDown={(event) => { if (event.key === "Enter") handleSearch(); }}
                            placeholder={t.banks.tagPlaceholder}
                            className="rounded-md border border-border bg-background px-3 py-2"
                        />
                    </label>
                    <label className="space-y-1 text-sm">
                        <span className="font-medium">{t.banks.gradeLabel}</span>
                        <select
                            value={grade}
                            onChange={(event) => setGrade(event.target.value)}
                            className="rounded-md border border-border bg-background px-3 py-2"
                        >
                            <option value="">{t.banks.allGrades}</option>
                            {grades.map((value) => (
                                <option key={value} value={value}>{GRADE_NAMES[value - 1]}</option>
                            ))}
                        </select>
                    </label>
                    <Button type="button" size="sm" onClick={handleSearch} disabled={loading}>
                        <Search className="mr-1 h-4 w-4" />
                        {t.banks.searchPlaceholder}
                    </Button>
                </div>

                {detail.questions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t.banks.noQuestions}</p>
                ) : (
                    <div className="space-y-3">
                        {detail.questions.map((question) => (
                            <BankQuestionCard
                                key={question.id}
                                bankId={detail.id}
                                question={question}
                                notebooks={notebooks}
                                onChanged={() => { void fetchPage(1); onChanged(); }}
                            />
                        ))}
                    </div>
                )}

                {detail.questions.length < detail.total && (
                    <Button type="button" variant="outline" onClick={() => { void fetchPage(detail.page + 1, true); }} disabled={loadingMore}>
                        {loadingMore ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                        {t.banks.loadMore}
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}
