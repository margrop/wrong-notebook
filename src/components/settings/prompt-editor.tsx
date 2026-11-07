"use client";

import { useMemo, useState } from "react";
import { ClipboardPaste, Copy, Info, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import { copyText, readClipboardText } from "@/lib/clipboard";
import { confirmDialog, toast } from "@/lib/feedback";

export interface PromptVariable {
    name: string;
    description: string;
}

interface PromptEditorProps {
    /** 模板当前值；为空时显示默认模板 */
    value: string;
    defaultValue: string;
    onChange: (value: string) => void;
    onReset: () => void;
    title: string;
    variables: PromptVariable[];
}

/** 模板中的变量名，用于检查保存后的模板还保留了多少 */
function templateVariables(template: string): string[] {
    return Array.from(new Set(Array.from(template.matchAll(/\{\{(\w+)\}\}/g), (match) => match[1])));
}

/**
 * 提示词模板编辑器：可复制当前模板、用剪贴板内容整体替换、恢复默认，
 * 并提示缺少的 {{变量}}，方便粘贴自己定制的模板后核对。
 */
export function PromptEditor({ value, defaultValue, onChange, onReset, title, variables }: PromptEditorProps) {
    const { t } = useLanguage();
    const [copied, setCopied] = useState(false);
    const missing = useMemo(() => {
        const present = new Set(templateVariables(value));
        return variables.filter((variable) => !present.has(variable.name));
    }, [value, variables]);

    const handleCopy = async () => {
        const ok = await copyText(value, (text) => window.prompt(t.settings?.prompts?.copyManual || "Copy the template manually:", text));
        if (!ok) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
        toast.success(t.settings?.prompts?.copied || "Template copied");
    };

    const handlePasteReplace = async () => {
        const text = await readClipboardText();
        if (text === null) {
            toast.error(t.settings?.prompts?.pasteFailed || "Cannot read the clipboard. Paste into the box manually.");
            return;
        }
        if (!text.trim()) {
            toast.error(t.settings?.prompts?.pasteEmpty || "The clipboard is empty");
            return;
        }
        if (value.trim() && !(await confirmDialog(t.settings?.prompts?.pasteConfirm || "Replace the current template with the clipboard content?", { destructive: true }))) return;
        onChange(text);
        toast.success(t.settings?.prompts?.pasted || "Template replaced from the clipboard");
    };

    const handleReset = async () => {
        if (!(await confirmDialog(t.settings?.prompts?.resetConfirm || "Are you sure you want to reset to default?", { destructive: true }))) return;
        onReset();
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-base font-semibold">{title}</Label>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={handleCopy}>
                        <Copy className="w-4 h-4 mr-2" />
                        {copied ? (t.settings?.prompts?.copied || "Copied") : (t.settings?.prompts?.copy || "Copy")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handlePasteReplace}>
                        <ClipboardPaste className="w-4 h-4 mr-2" />
                        {t.settings?.prompts?.pasteReplace || "Replace with clipboard"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleReset}>
                        <RotateCcw className="w-4 h-4 mr-2" />
                        {t.settings?.prompts?.reset || "Reset Default"}
                    </Button>
                </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-md p-3 flex items-start gap-3 text-amber-900 dark:text-amber-200 text-sm">
                <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                    <p className="font-medium">{t.settings?.prompts?.customizeTitle || "Tailor the prompt to your child"}</p>
                    <p>{t.settings?.prompts?.customizeBody || "Copy the default template, rewrite the role, tone and analysis steps to fit your child's grade, weak points and learning habits, then paste it back. Keep the {{variables}}: they are filled with each question's data."}</p>
                </div>
            </div>

            <div className="space-y-2 border rounded-md p-3 bg-background">
                <h4 className="text-xs font-medium flex items-center gap-1.5 mb-2">
                    <Info className="h-3.5 w-3.5" />
                    {t.settings?.prompts?.variables || "Available Variables"}
                </h4>
                <div className="space-y-1.5">
                    {variables.map((variable) => (
                        <div key={variable.name} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2 text-xs py-1">
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] shrink-0">{`{{${variable.name}}}`}</code>
                            <span className="text-muted-foreground">{variable.description}</span>
                        </div>
                    ))}
                </div>
                {missing.length > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 pt-1">
                        {(t.settings?.prompts?.missingVariables || "Not referenced in this template: {names}. The app still adds the matching rules, but the data will not reach the model.").replace(
                            "{names}",
                            missing.map((variable) => `{{${variable.name}}}`).join("、"),
                        )}
                    </p>
                )}
            </div>

            <Textarea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="font-mono text-xs min-h-[400px]"
                placeholder={defaultValue}
                aria-label={title}
            />
        </div>
    );
}