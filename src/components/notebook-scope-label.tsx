"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import { resolveNotebookScope, type NotebookStage, type NotebookSubject } from "@/lib/notebook-scope";

/** 学段与学科的界面文案 */
export function useNotebookScopeLabels() {
    const { t } = useLanguage();
    const stageLabel = (stage: NotebookStage) => ({
        primary: t.auth.primary,
        junior_high: t.auth.juniorHigh,
        senior_high: t.auth.seniorHigh,
        university: t.auth.university,
    })[stage];
    const subjectLabel = (subject: NotebookSubject) => t.tags.subjects[subject];
    return { stageLabel, subjectLabel };
}

interface NotebookScopeLabelProps {
    notebook: { name: string; stage?: string | null; subjectKey?: string | null };
    className?: string;
}

/** 显示错题本的「学段 · 学科」，如「小学 · 数学」 */
export function NotebookScopeLabel({ notebook, className }: NotebookScopeLabelProps) {
    const { stageLabel, subjectLabel } = useNotebookScopeLabels();
    const scope = resolveNotebookScope(notebook);
    return (
        <span className={className}>
            {stageLabel(scope.stage)}{scope.subject ? ` · ${subjectLabel(scope.subject)}` : ""}
        </span>
    );
}
