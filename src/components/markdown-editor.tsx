"use client";

import { useId, useState } from "react";
import type { ComponentProps, Ref } from "react";
import { Code2, Eye } from "lucide-react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

type EditorMode = "source" | "preview";

interface MarkdownEditorProps extends Omit<ComponentProps<"textarea">, "value" | "onChange"> {
    value: string;
    onChange: (value: string) => void;
    /** 外部拼音工具等需要按光标位置插入内容时传入 */
    textareaRef?: Ref<HTMLTextAreaElement>;
}

/**
 * 支持 Markdown 与 LaTeX 的编辑框：可在「源代码」和「预览」之间切换，
 * 预览与题目页面使用同一个渲染器，所见即最终显示效果。
 */
export function MarkdownEditor({ value, onChange, className, textareaRef, ...textareaProps }: MarkdownEditorProps) {
    const { t } = useLanguage();
    const [mode, setMode] = useState<EditorMode>("source");
    const panelId = useId();

    const tabs: { mode: EditorMode; label: string; icon: typeof Code2 }[] = [
        { mode: "source", label: t.markdownEditor.source, icon: Code2 },
        { mode: "preview", label: t.markdownEditor.preview, icon: Eye },
    ];

    return (
        <div className="space-y-1.5">
            <div role="tablist" aria-label={t.markdownEditor.modeLabel} className="flex justify-end">
                <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
                    {tabs.map(({ mode: tabMode, label, icon: Icon }) => (
                        <button
                            key={tabMode}
                            type="button"
                            role="tab"
                            aria-selected={mode === tabMode}
                            aria-controls={panelId}
                            onClick={() => setMode(tabMode)}
                            className={cn(
                                "flex items-center gap-1 rounded px-2.5 py-1 text-xs transition-colors",
                                mode === tabMode ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Icon className="h-3.5 w-3.5" />
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            <div id={panelId} role="tabpanel">
                {mode === "source" ? (
                    <Textarea ref={textareaRef} value={value} onChange={(e) => onChange(e.target.value)} className={className} {...textareaProps} />
                ) : (
                    <div
                        className="min-h-24 cursor-text rounded-md border bg-muted/20 px-3 py-2"
                        onDoubleClick={() => setMode("source")}
                        title={t.markdownEditor.doubleClickToEdit}
                    >
                        {value.trim()
                            ? <MarkdownRenderer content={value} />
                            : <p className="text-sm italic text-muted-foreground">{t.markdownEditor.empty}</p>}
                    </div>
                )}
            </div>
        </div>
    );
}
