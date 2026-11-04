"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, SquareFunction } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { ApiError, apiClient } from "@/lib/api-client";
import { useRunningTask } from "@/lib/hooks/use-running-task";
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
    /** 任务结束后重新加载页面数据（刷新页面后等待场景，服务端已保存结果） */
    onReload?: () => void;
}

/** 检测题目中的 LaTeX 语法错误，并用 AI 只修复公式写法；没有检测到错误时不显示 */
export function FixLatexButton({ errorItemId, fields, onDone, onReload }: FixLatexButtonProps) {
    const { t } = useLanguage();
    const [running, setRunning] = useState(false);
    // 按目标防重复：刷新页面后若任务仍在进行，按钮显示进行中并禁用
    const target = `error-item:${errorItemId}:fix-latex`;
    const { running: backgroundRunning, refresh } = useRunningTask(target);
    // 本次点击是否由本页发起（任务结束时避免重复触发 onReload）
    const initiatedHere = useRef(false);
    // 上一轮是否仍显示进行中（用于检测「刷新后等待的任务已结束」）
    const wasRunning = useRef(false);
    const issueCount = useMemo(() => countLatexIssues(findLatexIssuesByField(fields)), [fields]);

    const handleClick = async () => {
        setRunning(true);
        initiatedHere.current = true;
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
            if (error instanceof ApiError && error.status === 409 && (error.data as { code?: string })?.code === "TASK_ALREADY_RUNNING") {
                // 已有同 target 任务在运行：提示并进入等待（refresh 已把任务取到 store）
                toast.info(t.errors.TASK_ALREADY_RUNNING);
                // 等待的是其他页面发起的任务：结束时需要重新加载数据
                initiatedHere.current = false;
                await refresh();
            } else {
                const code = (error as { data?: { message?: string } })?.data?.message || "";
                const mapped = (t.errors as Record<string, unknown>)[code];
                frontendLogger.error('[FixLatex]', 'Failed to fix LaTeX', { code });
                toast.error(typeof mapped === "string" ? mapped : t.fixLatex.failed);
            }
        } finally {
            setRunning(false);
        }
    };

    // 刷新页面后等待场景：任务结束（running 由任务对象变为 null）时结果已由服务端写库，通知上层重新加载
    useEffect(() => {
        if (backgroundRunning) {
            wasRunning.current = true;
            return;
        }
        if (wasRunning.current && !initiatedHere.current) {
            onReload?.();
        }
        wasRunning.current = false;
        initiatedHere.current = false;
    }, [backgroundRunning, onReload]);

    const busy = running || !!backgroundRunning;
    if (issueCount === 0 && !busy) return null;

    return (
        <Button
            variant="outline"
            size="sm"
            onClick={handleClick}
            disabled={busy}
            className="border-amber-500 text-amber-700 dark:text-amber-400"
            title={t.fixLatex.issuesFound.replace("{count}", String(issueCount))}
        >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SquareFunction className="mr-2 h-4 w-4" />}
            {busy ? t.fixLatex.running : t.fixLatex.button}
            {!busy && issueCount > 0 && <span className="ml-1">({issueCount})</span>}
        </Button>
    );
}
