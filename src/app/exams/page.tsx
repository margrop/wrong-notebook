"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { formatDateTime } from "@/lib/date-time";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { ExamCreateForm } from "@/components/exam/exam-create-form";
import { ExamStatusBadge } from "@/components/exam/exam-status-badge";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/lib/page-title";
import { apiClient } from "@/lib/api-client";
import type { ExamPaperSummary } from "@/types/api";

export default function ExamsPage() {
    const { timeZone } = useTimeZone();
    const { t } = useLanguage();
    usePageTitle(t.exam.title);
    const [papers, setPapers] = useState<ExamPaperSummary[] | null>(null);
    const [showForm, setShowForm] = useState(false);

    useEffect(() => {
        apiClient.get<ExamPaperSummary[]>("/api/exams")
            .then((data) => {
                setPapers(data);
                if (data.length === 0) setShowForm(true);
            })
            .catch(() => setPapers([]));
    }, []);

    const difficultyLabels = t.practice.difficulty as Record<string, string>;

    return (
        <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 md:px-8 md:py-8">
            <div className="space-y-6">
                <PageHeader
                    title={t.exam.title}
                    description={t.exam.subtitle}
                    actions={!showForm && (
                        <Button onClick={() => setShowForm(true)} aria-label={t.exam.create}>
                            <Plus className="h-4 w-4" />
                            <span className="hidden sm:inline">{t.exam.create}</span>
                        </Button>
                    )}
                />

                {showForm && <ExamCreateForm />}

                <section className="space-y-3">
                    <h2 className="text-lg font-semibold">{t.exam.list}</h2>
                    {papers === null ? (
                        <PageLoading />
                    ) : papers.length === 0 ? (
                        <EmptyState icon={FileText} title={t.exam.empty} className="py-10" />
                    ) : (
                        <div className="grid gap-3 md:grid-cols-2">
                            {papers.map((paper) => (
                                <Link key={paper.id} href={`/exams/${paper.id}`}>
                                    <Card className="h-full rounded-2xl transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                                        <CardContent className="space-y-2 pt-4">
                                            <div className="flex items-start justify-between gap-2">
                                                <span className="flex items-center gap-2 font-medium">
                                                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                                                    {paper.title}
                                                </span>
                                                <ExamStatusBadge status={paper.status} recorded={paper.recordedCount > 0} />
                                            </div>
                                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                                <span>{formatDateTime(paper.createdAt, "yyyy-MM-dd HH:mm", timeZone)}</span>
                                                <span>{t.exam.questionCount.replace("{count}", String(paper.questionCount))}</span>
                                                <span>{t.exam.scopes[paper.scope]}</span>
                                                {paper.mode === 'original' ? (
                                                    <Badge variant="secondary">{t.exam.modes.original}</Badge>
                                                ) : (
                                                    <span>{difficultyLabels[paper.difficulty] || paper.difficulty}</span>
                                                )}
                                                <span>{paper.recordedCount > 0 ? t.exam.recorded : t.exam.notRecorded}</span>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}
