"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, Sparkles } from "lucide-react";
import { BatchImportPanel } from "@/components/batch-import-panel";
import { CorrectionEditor } from "@/components/correction-editor";
import { ImageCropper } from "@/components/image-cropper";
import { ImportResultBanner } from "@/components/import-result-banner";
import { PendingImportTask } from "@/components/import-tasks/pending-import-task";
import { QuestionPartsBar } from "@/components/question-parts-bar";
import { QuestionSaveError } from "@/components/question-save-error";
import { TextInputZone } from "@/components/text-input-zone";
import { UploadZone } from "@/components/upload-zone";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressFeedback } from "@/components/ui/progress-feedback";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { usePageTitle } from "@/lib/page-title";
import { MAX_QUESTION_PARTS, useQuestionImport } from "@/lib/hooks/use-question-import";
import { useStoredChoice } from "@/lib/hooks/use-stored-choice";
import { INPUT_MODE_STORAGE_KEY, NOTEBOOK_INPUT_MODES } from "@/lib/ui-preferences";
import type { NotebookInputMode } from "@/lib/ui-preferences";
import type { Notebook } from "@/types/api";

export default function AddErrorPage() {
    const params = useParams();
    const router = useRouter();
    const notebookId = params.id as string;
    const { t } = useLanguage();
    const [notebook, setNotebook] = useState<Notebook | null>(null);
    usePageTitle(t.notebooks.title, notebook?.name, t.pageTitle.addError);
    // 录入方式：image 拍照，text 文字录入；记住上次的选择
    const [inputMode, setInputMode] = useStoredChoice<NotebookInputMode>(INPUT_MODE_STORAGE_KEY, NOTEBOOK_INPUT_MODES, "image");

    // 本页的题目都放入当前错题本
    const flow = useQuestionImport({
        logPrefix: '[AddErrorItem]',
        analyzeSubjectId: notebookId,
        importSubjectId: notebookId,
        textNotebook: { id: notebookId, name: notebook?.name || "" },
        fixedSubjectId: notebookId,
    });

    useEffect(() => {
        apiClient.get<Notebook>(`/api/notebooks/${notebookId}`)
            .then(data => setNotebook(data))
            .catch(err => {
                frontendLogger.error('[AddErrorItem]', 'Failed to fetch notebook', { error: err });
                router.push("/notebooks");
            });
    }, [notebookId, router]);

    if (!notebook) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p className="text-muted-foreground">{t.common.loading}</p>
            </div>
        );
    }

    return (
        <main className="min-h-screen">
            <ProgressFeedback status={flow.analysisStep} completed={flow.completedStages} />

            <div className={`mx-auto space-y-6 px-4 py-6 md:px-8 md:py-8 ${flow.step === "review" ? "max-w-6xl" : "max-w-4xl"}`}>
                <QuestionSaveError message={flow.saveError} onDismiss={flow.dismissSaveError} />
                <PageHeader
                    backHref={`/notebooks/${notebookId}`}
                    title={t.app.addError}
                    description={notebook.name}
                />

                {flow.step === "upload" && (
                    <div className="space-y-4">
                        <SegmentedControl
                            options={[
                                { value: "image" as const, icon: Camera, label: t.app?.uploadImage || "Take Photo" },
                                { value: "text" as const, icon: Sparkles, label: t.app?.manualInput || "Manual Input" },
                            ]}
                            value={inputMode}
                            onChange={setInputMode}
                        />

                        {flow.pendingTask && (
                            <PendingImportTask task={flow.pendingTask} onRefresh={flow.refreshPendingTask} onDismiss={flow.dismissPendingTask} />
                        )}

                        {flow.lastImported && (
                            <ImportResultBanner imported={flow.lastImported} onDismiss={flow.dismissImported} />
                        )}

                        {flow.batchImages ? (
                            <BatchImportPanel
                                images={flow.batchImages}
                                subjectId={notebookId}
                                onClose={flow.closeBatch}
                            />
                        ) : inputMode === "image" ? (
                            <>
                                {flow.parts.length > 0 && (
                                    <QuestionPartsBar
                                        parts={flow.parts.map((part) => part.dataUrl)}
                                        busy={flow.isBusy}
                                        onFinish={() => void flow.finishParts()}
                                        onDiscard={flow.discardParts}
                                    />
                                )}
                                <UploadZone onImageSelect={flow.selectImage} isAnalyzing={flow.isBusy} />
                            </>
                        ) : (
                            <TextInputZone
                                onSubmit={flow.submitText}
                                isAnalyzing={flow.isBusy}
                                defaultNotebookName={notebook.name}
                                onCreateBatch={flow.createTextBatch}
                                creatingBatch={flow.creatingBatch}
                            />
                        )}
                    </div>
                )}

                {flow.step === "review" && flow.parsedData && (
                    <CorrectionEditor
                        initialData={flow.parsedData}
                        imagePreview={flow.currentImage}
                        onSave={flow.saveReviewed}
                        onCancel={flow.cancelReview}
                        initialSubjectId={notebookId}
                        aiTimeout={flow.aiTimeout}
                    />
                )}
            </div>

            <ImageCropper
                imageSrc={flow.croppingImage || ""}
                open={flow.isCropperOpen}
                onClose={flow.closeCropper}
                onRegionsSelected={flow.cropRegions}
                allowMulti={flow.parts.length === 0}
                onAutoSplit={flow.parts.length === 0 ? flow.autoSplitImage : undefined}
                onAddPart={flow.parts.length < MAX_QUESTION_PARTS - 1 ? flow.addPart : undefined}
                partCount={flow.parts.length}
            />
        </main>
    );
}
