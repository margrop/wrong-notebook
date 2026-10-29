"use client";

import { useState, useEffect } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";
import { GeogebraDraft } from "@/components/correction-editor/geogebra-draft";
import { MetaFields } from "@/components/correction-editor/meta-fields";
import { MistakeFields } from "@/components/correction-editor/mistake-fields";
import { PreviewPanel } from "@/components/correction-editor/preview-panel";
import { MarkdownEditor } from "@/components/markdown-editor";
import { TagInput } from "@/components/tag-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { apiClient } from "@/lib/api-client";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { calculateGrade } from "@/lib/grade-calculator";
import { inferSubjectFromName } from "@/lib/knowledge-tags";
import { normalizeMistakeStatusForSave } from "@/lib/mistake-status";
import { getDefaultPaperLevel } from "@/lib/paper-level";
import { getReanswerErrorMessage } from "@/lib/reanswer-error";
import { buildReanswerRequestBody } from "@/lib/reanswer-request";
import type { CorrectionDraft } from "@/components/correction-editor/types";
import type { ReanswerQuestionResult } from "@/lib/ai/types";
import type { Notebook, UserProfile } from "@/types/api";

interface CorrectionEditorProps {
    initialData: CorrectionDraft;
    onSave: (data: CorrectionDraft) => Promise<void>;
    onCancel: () => void;
    imagePreview?: string | null;
    initialSubjectId?: string;
    aiTimeout?: number;
}

/** AI 识别后的校对页：左侧编辑，右侧预览，确认后保存到错题本 */
export function CorrectionEditor({ initialData, onSave, onCancel, imagePreview, initialSubjectId, aiTimeout }: CorrectionEditorProps) {
    const { timeZone } = useTimeZone();
    const { t, language } = useLanguage();
    const [data, setData] = useState<CorrectionDraft>({
        ...initialData,
        wrongAnswerText: initialData.wrongAnswerText || "",
        mistakeAnalysis: initialData.mistakeAnalysis || "",
        mistakeStatus: initialData.mistakeStatus || "unknown",
        subjectId: initialSubjectId,
        gradeSemester: "",
    });
    const update = (fields: Partial<CorrectionDraft>) => setData(prev => ({ ...prev, ...fields }));
    // 未手工选卷时随星级更新默认值，手工选择后优先保留。
    const paperLevel = data.paperLevel ?? getDefaultPaperLevel(data.difficultyStars) ?? "a";
    const [isReanswering, setIsReanswering] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    // GeoGebra 动态演示默认关闭，用户在设置中开启后才显示
    const [geogebraEnabled, setGeogebraEnabled] = useState(false);
    const [educationStage, setEducationStage] = useState<string | undefined>(undefined);
    const [notebooks, setNotebooks] = useState<Notebook[]>([]);

    // 加载错题本（推断知识点学科）和用户信息（计算当前年级）
    useEffect(() => {
        apiClient.get<Notebook[]>("/api/notebooks")
            .then(setNotebooks)
            .catch(err => frontendLogger.error('[CorrectionEditor]', 'Failed to fetch notebooks', { error: err }));

        apiClient.get<UserProfile>("/api/user")
            .then(user => {
                setGeogebraEnabled(!!user?.enableGeogebra);
                if (user && user.educationStage && user.enrollmentYear) {
                    const grade = calculateGrade(user.educationStage, user.enrollmentYear, new Date(), language, timeZone);
                    setData(prev => ({ ...prev, gradeSemester: grade }));
                    setEducationStage(user.educationStage);
                }
            })
            .catch(err => frontendLogger.error('[CorrectionEditor]', 'Failed to fetch user info for grade calculation', { error: err }));
    }, [language, timeZone]);

    // 按修正后的题目重新解题
    const handleReanswer = async () => {
        if (!data.questionText.trim()) {
            toast.warning(t.editor.enterQuestionFirst || 'Please enter question text first');
            return;
        }

        setIsReanswering(true);
        try {
            const requestBody = buildReanswerRequestBody({
                questionText: data.questionText,
                language,
                subject: data.subject,
                imagePreview,
                gradeSemester: data.gradeSemester,
                subjectId: data.subjectId,
            });
            frontendLogger.info('[Reanswer]', requestBody.imageBase64 ? 'Sending image + text (image available for mistake analysis)' : 'Sending text only (no image available)', { timeout: aiTimeout });

            const result = await apiClient.post<ReanswerQuestionResult>("/api/reanswer", requestBody, { timeout: aiTimeout || 180000, recoverable: true });
            setData(prev => ({
                ...prev,
                answerText: result.answerText,
                analysis: result.analysis,
                knowledgePoints: result.knowledgePoints,
                wrongAnswerText: result.wrongAnswerText || "",
                mistakeAnalysis: result.mistakeAnalysis || "",
                mistakeStatus: normalizeMistakeStatusForSave(result.mistakeStatus, result.wrongAnswerText),
                // 重新解题给出星级时更新，否则保留原星级
                difficultyStars: result.difficultyStars ?? prev.difficultyStars,
            }));
            toast.success(t.editor.reanswerSuccess || '✅ Answer and analysis updated!');
        } catch (error) {
            frontendLogger.error('[CorrectionEditor]', 'Reanswer failed', { error });
            toast.error(getReanswerErrorMessage(error, t));
        } finally {
            setIsReanswering(false);
        }
    };

    const handleSave = async () => {
        if (!data.subjectId) {
            toast.warning(t.editor.messages?.selectNotebook || "Please select a notebook");
            return;
        }
        if (isSaving) return; // 防止重复点击
        setIsSaving(true);
        try {
            await onSave({ ...data, paperLevel, mistakeStatus: normalizeMistakeStatusForSave(data.mistakeStatus, data.wrongAnswerText) });
        } finally {
            setIsSaving(false);
        }
    };

    const markdownPlaceholder = t.editor.placeholder || "Supports Markdown and LaTeX...";
    const tagSubject = inferSubjectFromName(notebooks.find(n => n.id === data.subjectId)?.name || null) || inferSubjectFromName(data.subject || null) || undefined;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">{t.editor.title}</h2>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={onCancel}>
                        {t.editor.cancel}
                    </Button>
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        {isSaving ? (t.common?.pleaseWait || "Please wait...") : t.editor.save}
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                {/* 左侧：编辑区 */}
                <div className="space-y-6">
                    {imagePreview && (
                        <Card>
                            <CardContent className="p-4">
                                <img src={imagePreview} alt="Original" className="w-full rounded-md" />
                            </CardContent>
                        </Card>
                    )}

                    <MetaFields data={data} paperLevel={paperLevel} onChange={update} />

                    <div className="space-y-2">
                        <Label>{t.editor.question}</Label>
                        <MarkdownEditor
                            value={data.questionText}
                            onChange={(questionText) => update({ questionText })}
                            className="min-h-[150px] font-mono text-sm"
                            placeholder={markdownPlaceholder}
                        />
                        <Button
                            variant="default"
                            size="sm"
                            onClick={handleReanswer}
                            disabled={isReanswering || !data.questionText.trim()}
                            className="w-full bg-gradient-to-r from-indigo-600 to-violet-500 hover:from-indigo-700 hover:to-violet-600 text-white font-medium"
                        >
                            {isReanswering ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t.editor.reanswering || 'AI solving...'}</>
                            ) : (
                                <><RefreshCw className="mr-2 h-4 w-4" />{t.editor.reanswer || '🔄 Reanswer (based on corrected question)'}</>
                            )}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                            {t.editor.reanswerHint || '💡 If the question was misrecognized, correct it and click to regenerate answer'}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.editor.tags}</Label>
                        <TagInput
                            value={data.knowledgePoints}
                            onChange={(knowledgePoints) => update({ knowledgePoints })}
                            placeholder={t.editor.tagsPlaceholder || "Enter knowledge tags..."}
                            enterHint={t.editor.createTagHint}
                            subject={tagSubject}
                            gradeStage={educationStage}
                        />
                        <p className="text-xs text-muted-foreground">
                            {t.editor.tagsHint || "💡 Tag suggestions will appear as you type"}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>{t.editor.answer}</Label>
                        <MarkdownEditor value={data.answerText} onChange={(answerText) => update({ answerText })} className="min-h-[100px] font-mono text-sm" placeholder={markdownPlaceholder} />
                    </div>

                    <div className="space-y-2">
                        <Label>{t.editor.analysis}</Label>
                        <MarkdownEditor value={data.analysis} onChange={(analysis) => update({ analysis })} className="min-h-[200px] font-mono text-sm" placeholder={markdownPlaceholder} />
                    </div>

                    <MistakeFields data={data} onChange={update} />
                </div>

                {/* 右侧：预览区 */}
                <PreviewPanel data={data}>
                    {geogebraEnabled && <GeogebraDraft data={data} onChange={update} />}
                </PreviewPanel>
            </div>
        </div>
    );
}
