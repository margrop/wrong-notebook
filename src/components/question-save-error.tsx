"use client";

import { AlertTriangle, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface QuestionSaveErrorProps {
    message: string | null;
    onDismiss: () => void;
}

/** 表单保留失败原因，避免较长的处理建议随轻提示消失。 */
export function QuestionSaveError({ message, onDismiss }: QuestionSaveErrorProps) {
    const { t } = useLanguage();
    if (!message) return null;
    return (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1 whitespace-pre-line break-words leading-relaxed">{message}</p>
            <button type="button" onClick={onDismiss} aria-label={t.common.close} className="shrink-0 rounded p-1 hover:bg-destructive/10">
                <X aria-hidden="true" className="h-4 w-4" />
            </button>
        </div>
    );
}
