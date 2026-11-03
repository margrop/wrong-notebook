"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

interface IgnoredContentProps {
    ignored: string[];
    /** 把第 index 段加为新题 */
    onRestore: (index: number) => void;
}

/** 分题预览中「未计入题目的内容」：默认折叠，可把其中一段加为题目 */
export function IgnoredContent({ ignored, onRestore }: IgnoredContentProps) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    if (ignored.length === 0) return null;
    return (
        <section className="rounded-xl border p-3">
            <button type="button" className="flex w-full items-center justify-between text-left text-sm font-medium" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
                {t.importBatch.ignoredTitle.replace("{count}", String(ignored.length))}
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {open && (
                <div className="mt-2 space-y-2">
                    <p className="text-xs text-muted-foreground">{t.importBatch.ignoredHint}</p>
                    <ul className="space-y-2">
                        {ignored.map((text, index) => (
                            <li key={`${index}-${text.slice(0, 20)}`} className="flex items-start gap-2 rounded-lg bg-muted/50 p-2 text-sm">
                                <p className="min-w-0 flex-1 whitespace-pre-line break-words text-muted-foreground">{text}</p>
                                <Button type="button" size="sm" variant="outline" className="h-7 shrink-0" onClick={() => onRestore(index)}>
                                    {t.importBatch.addAsQuestion}
                                </Button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}
