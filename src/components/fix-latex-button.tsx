"use client";

import { useMemo, useState } from "react";
import { Loader2, SquareFunction } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { countLatexIssues, findLatexIssuesByField } from "@/lib/latex-check";
import type { LatexField } from "@/lib/latex-check";
import { toast } from "@/lib/feedback";

const FIX_TIMEOUT_MS = 5 * 60 * 1000;

type LatexFields = Partial<Record<LatexField, string | null | undefined>>;

interface FixLatexResponse {
    issuesBefore: number;
    issuesAfter: number;
    fixedFields: LatexField[];
    updated: Partial<Record<LatexField, string>>;
}

interface FixLatexButtonProps {
    errorItemId: string;
    /** 当前题目内容，用于在按钮上显示检测到的问题数 */
    fields: LatexFields;
    /** 保存后回调修复过的字段 */
    onDone: (updated: Partial<Record<LatexField, string>>) => void;
}

/** 检测题目中的 LaTeX 语法错误，并用 AI 只修复公式写法；没有检测到错误时不显示 */
export function FixLatexButton({ errorItemId, fields, onDone }: FixLatexButtonProps) {
    const { t } = useLanguage();
    const [running, setRunning] = useState(false);
    const issueCount = useMemo(() => countLatexIssues(findLatexIssuesByField(fields)), [fields]);

    const handleClick = async () => {
        setRunning(true);
        try {
            const result = await apiClient.post<FixLatexResponse>(`/api/error-items/${errorItemId}/fix-latex`, {}, { timeout: FIX_TIMEOUT_MS, recoverable: true });
            onDone(result.updated);
            const fieldNames = result.fixedFields.map((field) => t.fixLatex.fields[field]).join(t.common.listSeparator);
            toast.info(
                result.issuesBefore === 0 ? t.fixLatex.noIssues
                    : result.fixedFields.length === 0 ? t.fixLatex.notFixed
                        : result.issuesAfter === 0 ? t.fixLatex.fixedAll.replace("{fields}", fieldNames)
                            : t.fixLatex.fixedPartly.replace("{fields}", fieldNames).replace("{count}", String(result.issuesAfter))
            );
        } catch (error) {
            const code = (error as { data?: { message?: string } })?.data?.message || "";
            const mapped = (t.errors as Record<string, unknown>)[code];
            frontendLogger.error('[FixLatex]', 'Failed to fix LaTeX', { code });
            toast.error(typeof mapped === "string" ? mapped : t.fixLatex.failed);
        } finally {
            setRunning(false);
        }
    };

    if (issueCount === 0 && !running) return null;

    return (
        <Button
            variant="outline"
            size="sm"
            onClick={handleClick}
            disabled={running}
            className="border-amber-500 text-amber-700 dark:text-amber-400"
            title={t.fixLatex.issuesFound.replace("{count}", String(issueCount))}
        >
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SquareFunction className="mr-2 h-4 w-4" />}
            {running ? t.fixLatex.running : t.fixLatex.button}
            {!running && issueCount > 0 && <span className="ml-1">({issueCount})</span>}
        </Button>
    );
}
