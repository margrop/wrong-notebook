"use client";

import { MarkdownEditor } from "@/components/markdown-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import type { MistakeStatus } from "@/lib/question/mistake-status";
import type { CorrectionDraft, UpdateDraft } from "./types";

interface MistakeFieldsProps {
    data: CorrectionDraft;
    onChange: UpdateDraft;
}

/** 作答状态、错误解答原文与错因分析；填写错误解答时作答状态自动改为做错了 */
export function MistakeFields({ data, onChange }: MistakeFieldsProps) {
    const { t } = useLanguage();

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t.editor.mistakeAnalysisTitle || "Mistake Analysis"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>{t.editor.mistakeStatus || "Attempt Status"}</Label>
                    <Select value={data.mistakeStatus || "unknown"} onValueChange={(val) => onChange({ mistakeStatus: val as MistakeStatus })}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="not_attempted">{t.editor.mistakeStatuses?.notAttempted || "Not attempted"}</SelectItem>
                            <SelectItem value="wrong_attempt">{t.editor.mistakeStatuses?.wrongAttempt || "Wrong attempt"}</SelectItem>
                            <SelectItem value="unknown">{t.editor.mistakeStatuses?.unknown || "Unknown"}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>{t.editor.wrongAnswerText || "Wrong Answer / Work"}</Label>
                    <MarkdownEditor
                        value={data.wrongAnswerText || ""}
                        onChange={(value) => onChange({ wrongAnswerText: value, mistakeStatus: value.trim() ? "wrong_attempt" : data.mistakeStatus })}
                        className="min-h-[100px] font-mono text-sm"
                        placeholder={t.editor.wrongAnswerPlaceholder || "Leave blank if no wrong answer is visible"}
                    />
                </div>
                <div className="space-y-2">
                    <Label>{t.editor.mistakeAnalysis || "Mistake Cause Analysis"}</Label>
                    <MarkdownEditor
                        value={data.mistakeAnalysis || ""}
                        onChange={(value) => onChange({ mistakeAnalysis: value })}
                        className="min-h-[140px] font-mono text-sm"
                        placeholder={t.editor.mistakeAnalysisPlaceholder || "Explain where and why the mistake happened"}
                    />
                </div>
            </CardContent>
        </Card>
    );
}
