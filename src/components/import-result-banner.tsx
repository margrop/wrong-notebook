"use client";

import Link from "next/link";
import { CheckCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ImportedQuestion } from "@/lib/import/question-import";

interface ImportResultBannerProps {
    imported: ImportedQuestion;
    onDismiss: () => void;
}

/** 免确认导入成功后的提示条 */
export function ImportResultBanner({ imported, onDismiss }: ImportResultBannerProps) {
    const { t } = useLanguage();
    const message = (imported.duplicate ? t.importFlow.duplicate : t.importFlow.imported)
        .replace("{notebook}", imported.notebookName || "-")
        .replace("{id}", imported.shortId || "-");

    return (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-3 text-sm text-green-800 dark:text-green-200" role="status">
            <span className="flex items-start gap-2 flex-1">
                <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {message}
            </span>
            <div className="flex gap-2 shrink-0">
                <Link href={`/error-items/${imported.id}`}>
                    <Button size="sm" variant="outline" className="bg-background">{t.importFlow.viewItem}</Button>
                </Link>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onDismiss} aria-label={t.detail.close}>
                    <X className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
