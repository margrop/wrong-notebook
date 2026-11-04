"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileQuestion, RefreshCw, Trash2 } from "lucide-react";
import { DifficultyStars } from "@/components/difficulty-stars";
import { GeogebraSection } from "@/components/error-detail/geogebra-section";
import { ImageViewer } from "@/components/error-detail/image-viewer";
import { MarkdownFieldCard } from "@/components/error-detail/markdown-field-card";
import { NotesCard } from "@/components/error-detail/notes-card";
import { QuestionCard } from "@/components/error-detail/question-card";
import { ToggleImage } from "@/components/error-detail/toggle-image";
import { WrongAnswerCard } from "@/components/error-detail/wrong-answer-card";
import { FixLatexButton } from "@/components/fix-latex-button";
import { MasteryPanel } from "@/components/mastery-panel";
import { MasteryStatusBadge } from "@/components/mastery-status-badge";
import { RegenerateAnswerButton } from "@/components/regenerate-answer-button";
import { ShortIdBadge } from "@/components/short-id-badge";
import { SvgAnimationExplainer } from "@/components/svg-animation-explainer";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageLoading } from "@/components/ui/page-loading";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { confirmDialog, toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { usePageTitle } from "@/lib/page-title";
import type { ErrorItemDetail } from "@/components/error-detail/types";
import type { MasteryStatus } from "@/lib/mastery-status";
import type { UserProfile } from "@/types/api";

export default function ErrorDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { t, language } = useLanguage();
    const [item, setItem] = useState<ErrorItemDetail | null>(null);
    usePageTitle(t.detail.title, item?.subject?.name, item?.shortId);
    const [loading, setLoading] = useState(true);
    // 放大查看的图片地址，为空时不显示查看器
    const [viewerImageUrl, setViewerImageUrl] = useState<string | null>(null);
    const [showReferenceImage, setShowReferenceImage] = useState(false);
    const [educationStage, setEducationStage] = useState<string | undefined>(undefined);
    // GeoGebra 动态演示默认关闭，用户在设置中开启后才显示
    const [geogebraEnabled, setGeogebraEnabled] = useState(false);
    // SVG 动画讲解默认开启，用户可在设置中关闭
    const [svgAnimationEnabled, setSvgAnimationEnabled] = useState(true);
    // 复习状态由举一反三记录和掌握概率决定，随掌握面板的数据更新
    const [masteryStatus, setMasteryStatus] = useState<MasteryStatus | null>(null);
    const [savingDifficulty, setSavingDifficulty] = useState(false);

    const fetchItem = useCallback(async (id: string) => {
        try {
            const data = await apiClient.get<ErrorItemDetail>(`/api/error-items/${id}`);
            setItem(data);
        } catch (error) {
            frontendLogger.error('[ErrorDetail]', 'Failed to fetch error item', { error });
            toast.error(t.common?.messages?.loadFailed || 'Failed to load item');
            router.push("/notebooks");
        } finally {
            setLoading(false);
        }
    }, [router, t]);

    useEffect(() => {
        apiClient.get<UserProfile>("/api/user")
            .then(user => {
                if (user && user.educationStage) {
                    setEducationStage(user.educationStage);
                }
                setGeogebraEnabled(!!user?.enableGeogebra);
                setSvgAnimationEnabled(user?.enableSvgAnimation !== false);
            })
            .catch(err => frontendLogger.error('[ErrorDetail]', 'Failed to fetch user info', { error: err }));

        if (params.id) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面或条件变化时加载，请求前后更新加载状态和结果
            fetchItem(params.id as string);
        }
    }, [params.id, fetchItem]);

    const updateItem = useCallback((fields: Partial<ErrorItemDetail>) => {
        setItem((current) => current && { ...current, ...fields });
    }, []);

    // 保存字段并合并到页面状态，失败时抛出，由各卡片提示
    const saveFields = async (fields: Partial<ErrorItemDetail>) => {
        if (!item) return;
        await apiClient.put(`/api/error-items/${item.id}`, fields);
        updateItem(fields);
    };

    const reload = async () => {
        if (item) await fetchItem(item.id);
    };

    const handleDifficultyChange = async (difficultyStars: number | null) => {
        if (!item) return;
        const previous = item.difficultyStars ?? null;
        updateItem({ difficultyStars });
        setSavingDifficulty(true);
        try {
            const updated = await apiClient.put<Pick<ErrorItemDetail, "paperLevel">>(`/api/error-items/${item.id}`, { difficultyStars });
            updateItem({ paperLevel: updated.paperLevel });
        } catch (error) {
            updateItem({ difficultyStars: previous });
            frontendLogger.error('[ErrorDetail]', 'Failed to save difficulty', { error });
            toast.error(t.difficulty.saveFailed);
        } finally {
            setSavingDifficulty(false);
        }
    };

    // 动画按语言分别保存，生成或删除只影响对应语言的版本
    const handleSvgAnimationChange = useCallback((animationLanguage: 'zh' | 'en', svgAnimation: string | null) => {
        updateItem({ [animationLanguage === 'en' ? 'svgAnimationEn' : 'svgAnimation']: svgAnimation });
    }, [updateItem]);

    const deleteItem = async () => {
        if (!item) return;
        if (!(await confirmDialog(t.common?.messages?.confirmDelete || 'Are you sure you want to delete this error item?', { destructive: true }))) return;

        try {
            await apiClient.delete(`/api/error-items/${item.id}/delete`);
            toast.success(t.common?.messages?.deleteSuccess || 'Deleted successfully');
            router.push(item.subjectId ? `/notebooks/${item.subjectId}` : '/notebooks');
        } catch (error) {
            frontendLogger.error('[ErrorDetail]', 'Failed to delete error item', { error });
            toast.error(t.common?.messages?.deleteFailed || 'Delete failed');
        }
    };

    if (loading) return <PageLoading label={t.common.loading} />;
    if (!item) return <EmptyState icon={FileQuestion} title={t.detail.notFound || "Item not found"} className="m-4 md:m-8" />;

    return (
        <main className="min-h-screen">
            <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8 md:py-8">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <Link href={item.subjectId ? `/notebooks/${item.subjectId}` : "/notebooks"}>
                            <Button variant="ghost" size="icon" className="-ml-2">
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                        </Link>
                        <h1 className="text-2xl font-bold tracking-tight">{t.detail.title}</h1>
                        <ShortIdBadge shortId={item.shortId} />
                        <DifficultyStars size="md" value={item.difficultyStars} onChange={handleDifficultyChange} disabled={savingDifficulty} />
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <FixLatexButton errorItemId={item.id} fields={item} onDone={updateItem} onReload={reload} />
                        <Link href={`/practice?id=${item.id}`}>
                            <Button variant="outline" size="sm">
                                <RefreshCw className="mr-2 h-4 w-4" />
                                {t.detail.practice}
                            </Button>
                        </Link>
                        {masteryStatus && <MasteryStatusBadge status={masteryStatus} className="h-8 self-center px-3" />}
                        <Button variant="ghost" size="sm" onClick={deleteItem} className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40">
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t.detail.delete || "Delete"}
                        </Button>
                    </div>
                </div>

                <QuestionCard item={item} educationStage={educationStage} saveFields={saveFields} onUpdate={updateItem} reload={reload} onEnlarge={setViewerImageUrl} />

                <MasteryPanel errorItemId={item.id} onMasteryStatusChange={setMasteryStatus} />

                <div className="grid gap-6 lg:grid-cols-2">
                    <MarkdownFieldCard
                        title={t.detail.correctAnswer}
                        value={item.answerText}
                        onSave={(answerText) => saveFields({ answerText })}
                        logLabel="answer"
                        rows={5}
                        placeholder="Enter answer..."
                        cardClassName="border-primary/20"
                        titleClassName="text-primary"
                        contentClassName="font-semibold"
                        headerActions={<RegenerateAnswerButton errorItemId={item.id} onDone={(updated) => updateItem({ answerText: updated.answerText ?? "", analysis: updated.analysis ?? "" })} onReload={reload} />}
                    >
                        {item.referenceImageUrl && (
                            <div className="pt-3">
                                <ToggleImage src={item.referenceImageUrl} alt={t.detail.referenceImageAlt} showLabel={t.detail.viewImage} hideLabel={t.detail.hideImage} visible={showReferenceImage} onVisibleChange={setShowReferenceImage} onEnlarge={setViewerImageUrl} />
                            </div>
                        )}
                    </MarkdownFieldCard>
                    <WrongAnswerCard item={item} saveFields={saveFields} onEnlarge={setViewerImageUrl} />
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                    <MarkdownFieldCard
                        title={t.detail.analysis}
                        value={item.analysis}
                        onSave={(analysis) => saveFields({ analysis })}
                        logLabel="analysis"
                        rows={12}
                        placeholder="Enter analysis..."
                    />
                    <MarkdownFieldCard
                        title={t.detail?.mistakeAnalysis || "Mistake Analysis"}
                        value={item.mistakeAnalysis}
                        onSave={(mistakeAnalysis) => saveFields({ mistakeAnalysis })}
                        logLabel="mistake analysis"
                        rows={8}
                        editorLabel={t.editor?.mistakeAnalysis || "Mistake Cause Analysis"}
                        emptyText={t.detail?.noMistakeAnalysis || "No mistake analysis yet."}
                    />
                </div>

                <div className="space-y-6">
                    {svgAnimationEnabled && (
                        // 切换界面语言时自动显示对应语言的动画；key 让播放器随语言重新加载
                        <SvgAnimationExplainer
                            key={language}
                            errorItemId={item.id}
                            svgAnimation={language === 'en' ? item.svgAnimationEn : item.svgAnimation}
                            hasOtherLanguage={!!(language === 'en' ? item.svgAnimation : item.svgAnimationEn)}
                            onChange={handleSvgAnimationChange}
                        />
                    )}

                    {geogebraEnabled && <GeogebraSection errorItemId={item.id} commands={item.geogebraCommands} onUpdate={updateItem} />}

                    <NotesCard item={item} onUpdate={updateItem} />
                </div>
            </div>

            <ImageViewer src={viewerImageUrl} onClose={() => setViewerImageUrl(null)} />
        </main>
    );
}
