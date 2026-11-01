"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { ApiError, apiClient } from "@/lib/api-client";
import { CNM_REPO_URL, CNM_TOPICS_URL } from "@/lib/cnm-tags";
import type { CnmImportResult, CnmStatus } from "@/lib/cnm-tags";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";

const API_URL = "/api/admin/cnm-tags";
/** 导入约 3000 个知识点，留足时间 */
const IMPORT_TIMEOUT_MS = 5 * 60 * 1000;

/** 管理员导入人教版课标知识点（cn-math-taxonomy），导入后创建错题本时可选择该标签体系 */
export function CnmTagImportSettings() {
    const { t } = useLanguage();
    const text = t.admin.cnmTags;
    const [status, setStatus] = useState<CnmStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const refresh = useCallback(async () => {
        try {
            setStatus(await apiClient.get<CnmStatus>(API_URL));
        } catch (error) {
            frontendLogger.warn('[CnmTagImportSettings]', 'Failed to load status', { error });
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：打开面板时加载已导入数量
        refresh();
    }, [refresh]);

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        setBusy(true);
        try {
            let topics: unknown;
            try {
                topics = JSON.parse(await file.text());
            } catch {
                toast.error(text.invalidFile);
                return;
            }
            const data = await apiClient.post<{ result: CnmImportResult; status: CnmStatus }>(API_URL, { topics }, { timeout: IMPORT_TIMEOUT_MS });
            setStatus(data.status);
            toast.success(text.imported
                .replace('{created}', String(data.result.created))
                .replace('{skipped}', String(data.result.skipped)));
        } catch (error) {
            frontendLogger.error('[CnmTagImportSettings]', 'Import failed', { error });
            const invalid = error instanceof ApiError && error.status === 400;
            toast.error(invalid ? text.invalidFile : text.failed);
        } finally {
            setBusy(false);
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    const imported = status?.knowledgePoints ?? 0;

    return (
        <div className="space-y-3 rounded-lg border p-4">
            <div className="space-y-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                    <BookOpen className="h-4 w-4" />
                    {text.title}
                </p>
                <p className="text-xs text-muted-foreground">{text.desc}</p>
            </div>

            <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                <p>{text.downloadHint}</p>
                <a href={CNM_TOPICS_URL} target="_blank" rel="noopener noreferrer" className="block break-all text-primary underline">
                    {CNM_TOPICS_URL}
                </a>
                <p>
                    {text.sourceLabel}{" "}
                    <a href={CNM_REPO_URL} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">
                        {CNM_REPO_URL}
                    </a>
                </p>
            </div>

            <p className="text-xs text-muted-foreground">
                {status ? (imported > 0 ? text.status.replace('{count}', String(imported)) : text.notImported) : ""}
            </p>

            <input
                ref={inputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
                disabled={busy}
            />
            <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => inputRef.current?.click()} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {busy ? text.importing : text.select}
            </Button>

            <p className="text-xs text-muted-foreground">{text.note}</p>
        </div>
    );
}
