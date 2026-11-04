"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Layers, Loader2, PenLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ImportFileButton } from "@/components/import-file-button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import { confirmDialog, toast } from "@/lib/feedback";
import { IMPORT_FILE_TYPES, decodeTextFile, detectImportFileType } from "@/lib/import/file-read";
import { frontendLogger } from "@/lib/frontend-logger";
import { getErrorMessage } from "@/lib/error-message";
import { MAX_SPLIT_TEXT_LENGTH, splitQuestionText } from "@/lib/question-split/text";

interface TextInputZoneProps {
    onSubmit: (questionText: string) => Promise<void>;
    isAnalyzing: boolean;
    defaultNotebookName?: string;
    /** 多题：创建分题批次（local 本地规则，不调用 AI；ai 由模型分题；forceNumbered 时编号像小问也按编号分题）。不提供时只有单题路径 */
    onCreateBatch?: (text: string, splitter: "local" | "ai", forceNumbered?: boolean) => Promise<void>;
    creatingBatch?: boolean;
    /** 用户选择了题库文件（docx/xlsx/csv/json）时回调，由父组件切换到「导入题库文件」入口 */
    onSwitchToFileImport?: () => void;
}

/**
 * 文字录入：输入时用本地规则实时检测编号题（不调用 AI）。检测到多道题时主按钮为「分题预览」，
 * 仍可「作为一道题解析」；没有检测到时保持原来的单题「AI 解题」，并提供「用 AI 分题」入口。
 */
export function TextInputZone({ onSubmit, isAnalyzing, defaultNotebookName, onCreateBatch, creatingBatch = false, onSwitchToFileImport }: TextInputZoneProps) {
    const { t } = useLanguage();
    const [questionText, setQuestionText] = useState("");
    const deferredText = useDeferredValue(questionText);
    const detection = useMemo(() => (onCreateBatch && deferredText.trim() ? splitQuestionText(deferredText) : null), [deferredText, onCreateBatch]);
    const multi = detection?.detected ? detection.candidateCount : 0;
    const ambiguousCount = detection?.ambiguous ? detection.candidateCount : 0;
    const tooLong = questionText.length > MAX_SPLIT_TEXT_LENGTH;
    const busy = isAnalyzing || creatingBatch;
    const text = questionText.trim();

    const solveAsOne = async () => {
        if (!text) return;
        await onSubmit(text);
    };
    const preview = async (splitter: "local" | "ai", forceNumbered = false) => {
        if (!text || !onCreateBatch) return;
        // 本地分题超过上限时由服务端拒绝；AI 分题文字超长时禁用入口
        if (splitter === "ai" && tooLong) return;
        await onCreateBatch(questionText, splitter, forceNumbered);
    };

    /**
     * 从文件导入：TXT / Markdown 内容填入文字框；已有内容时询问替换或追加。
     * 题库文件（docx / xlsx / csv / json）不在这里解码，提示并切换到「导入题库文件」入口。
     */
    const handleImportFile = async (file: File) => {
        const detected = detectImportFileType(file.name, file.type);
        if (detected && detected.key !== "text") {
            if (onSwitchToFileImport) {
                const ok = await confirmDialog(t.importFile.bankFileHint, {
                    confirmText: t.importFile.bankFileSwitch,
                    cancelText: t.importFile.bankFileStay,
                });
                if (ok) onSwitchToFileImport();
            } else {
                toast.info(t.importFile.bankFileHint);
            }
            return;
        }
        let content: string;
        try {
            const buffer = await file.arrayBuffer();
            content = decodeTextFile(buffer).text;
        } catch (error) {
            frontendLogger.error("text-input-zone", "Failed to read import file", { error: getErrorMessage(error) });
            toast.error(t.importFile.readFailed);
            return;
        }
        if (questionText.trim()) {
            const replace = await confirmDialog(t.app.importFileReplaceConfirm, { confirmText: t.app.importFileReplace, cancelText: t.app.importFileAppend });
            setQuestionText(replace ? content : questionText + "\n" + content);
        } else {
            setQuestionText(content);
        }
    };

    // 「用 AI 分题」入口：没检测到多题时用于未编号的题；检测到多题时用于本地规则分错（如 OCR 认错题号）
    const aiSplitEntry = (label: string) => onCreateBatch && text ? (
        <div className="text-center">
            <Button variant="link" size="sm" onClick={() => preview("ai")} disabled={busy || tooLong} className="h-auto whitespace-normal">
                {creatingBatch ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Layers className="mr-1 h-3 w-3" />}
                {creatingBatch ? t.app.creatingBatch : label}
            </Button>
            <p className="text-xs text-muted-foreground">{t.app.aiSplitHint}</p>
        </div>
    ) : null;

    // Ctrl/⌘+Enter 执行当前的主操作
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            if (!text || busy) return;
            void (multi > 1 && !tooLong ? preview("local") : solveAsOne());
        }
    };

    return (
        <Card className="rounded-2xl">
            <CardContent className="space-y-4 p-6">
                <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                    <PenLine className="h-5 w-5" />
                    <span className="text-sm font-medium">{t.app?.textInputHint || "Enter question text"}</span>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="question-text">{t.editor?.question || "Question Text"}</Label>
                        <ImportFileButton
                            types={IMPORT_FILE_TYPES}
                            onFile={handleImportFile}
                            disabled={busy}
                        />
                    </div>
                    <Textarea
                        id="question-text"
                        value={questionText}
                        onChange={(e) => setQuestionText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t.app?.textInputPlaceholder || "Paste or type question text here..."}
                        className="min-h-[200px] resize-y font-mono text-sm"
                        disabled={busy}
                    />
                </div>

                {defaultNotebookName && (
                    <p className="text-xs text-muted-foreground">{t.notebooks?.title || "My Notebooks"}: {defaultNotebookName}</p>
                )}

                {onCreateBatch && tooLong && (
                    <p className="text-sm text-destructive" role="alert">{t.app.textTooLong}</p>
                )}

                {multi > 1 ? (
                    <div className="space-y-2" data-testid="multi-detected">
                        <p className="flex items-center gap-2 text-sm font-medium text-primary">
                            <Layers className="h-4 w-4" />
                            {t.app.multiDetected.replace("{count}", String(multi))}
                        </p>
                        {(detection?.overflow ?? 0) > 0 && (
                            <p className="text-xs text-amber-700 dark:text-amber-300">{t.app.overflowHint.replace("{count}", String(detection?.overflow))}</p>
                        )}
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <Button onClick={() => preview("local")} disabled={busy} size="lg" className="flex-1 bg-gradient-to-r from-indigo-600 to-violet-500 font-medium text-white hover:from-indigo-700 hover:to-violet-600">
                                {creatingBatch ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Layers className="mr-2 h-4 w-4" />}
                                {creatingBatch ? t.app.creatingBatch : t.app.splitPreview.replace("{count}", String(Math.min(multi, 60)))}
                            </Button>
                            <Button onClick={solveAsOne} disabled={busy} size="lg" variant="outline">
                                {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                                {isAnalyzing ? t.editor?.reanswering || "AI solving..." : t.app.solveAsOne}
                            </Button>
                        </div>
                        {aiSplitEntry(t.app.aiSplitMulti)}
                    </div>
                ) : (
                    <>
                        <Button
                            onClick={solveAsOne}
                            disabled={!text || busy}
                            className="w-full bg-gradient-to-r from-indigo-600 to-violet-500 font-medium text-white hover:from-indigo-700 hover:to-violet-600"
                            size="lg"
                        >
                            {isAnalyzing ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t.editor?.reanswering || "AI solving..."}</>
                            ) : (
                                <><Sparkles className="mr-2 h-4 w-4" />{t.app?.aiSolve || "AI Solve"}</>
                            )}
                        </Button>
                        {ambiguousCount > 1 && (
                            <div className="space-y-1 rounded-lg bg-muted/60 p-3 text-center" data-testid="sub-questions-hint">
                                <p className="text-xs text-muted-foreground">{t.app.subQuestionsHint.replace("{count}", String(ambiguousCount))}</p>
                                <Button variant="outline" size="sm" onClick={() => preview("local", true)} disabled={busy || tooLong}>
                                    <Layers className="mr-1 h-3 w-3" />{t.app.splitAnyway.replace("{count}", String(ambiguousCount))}
                                </Button>
                            </div>
                        )}
                        {aiSplitEntry(t.app.aiSplit)}
                    </>
                )}

                <p className="text-center text-xs text-muted-foreground">
                    {t.app?.textInputTip || "After entering the question, AI will automatically solve and generate analysis"}
                </p>
            </CardContent>
        </Card>
    );
}
