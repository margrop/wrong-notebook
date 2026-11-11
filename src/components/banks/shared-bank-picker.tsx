"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { toast } from "@/lib/feedback";
import { getApiErrorMessage } from "@/lib/error-message";
import { frontendLogger } from "@/lib/frontend-logger";
import { bankErrorCodeFromMessage } from "@/lib/question-bank/errors";
import { bankPackageUrl, parseBankFile, parseBankIndex } from "@/lib/question-bank/format";
import { DEFAULT_BANK_INDEX_URL } from "@/lib/question-bank/types";
import type { BankIndexPackage } from "@/lib/question-bank/types";
import type { BankImportResult } from "@/lib/question-bank/types";

const STAGE_KEYS: Record<string, "primary" | "juniorHigh" | "seniorHigh" | "university"> = {
    primary: "primary",
    junior_high: "juniorHigh",
    senior_high: "seniorHigh",
    university: "university",
};

interface SharedBankPickerProps {
    /** 已导入的题库名称；同名题库的按钮显示为「已导入」 */
    existingNames: string[];
    onImported: () => void;
}

/** 从共享题库仓库读取索引并逐包导入；只进入真题库，不写入错题 */
export function SharedBankPicker({ existingNames, onImported }: SharedBankPickerProps) {
    const { t } = useLanguage();
    const importedNames = new Set(existingNames.map((name) => name.trim()));
    const [packages, setPackages] = useState<BankIndexPackage[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [importingId, setImportingId] = useState<string | null>(null);

    const loadIndex = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
            const response = await fetch(DEFAULT_BANK_INDEX_URL, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const parsed = parseBankIndex(await response.json());
            if (!parsed.success) throw new Error(parsed.error);
            setPackages(parsed.data.packages);
        } catch (err) {
            frontendLogger.warn('[Banks]', 'Failed to load shared bank index', { error: err });
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面时读取共享题库索引
        void loadIndex();
    }, [loadIndex]);

    const handleImport = async (item: BankIndexPackage) => {
        setImportingId(item.id);
        try {
            const response = await fetch(bankPackageUrl(DEFAULT_BANK_INDEX_URL, item.file), { cache: "no-store", signal: AbortSignal.timeout(30_000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const raw: unknown = await response.json();
            const parsed = parseBankFile(raw);
            if (!parsed.success) throw new Error(parsed.error);
            const result = await apiClient.post<BankImportResult>("/api/question-banks", {
                file: raw,
                name: parsed.data.meta.title,
                addToErrorItems: false,
            }, { timeout: 300_000, recoverable: true });
            toast.success((t.banks.imported || "Imported {name} with {count} questions.")
                .replace("{name}", result.bank.name)
                .replace("{count}", String(result.bank.questionCount)));
            onImported();
        } catch (err) {
            const rawMessage = getApiErrorMessage(err);
            const code = bankErrorCodeFromMessage(rawMessage);
            const message = (code ? t.errors[code] : rawMessage) || (t.banks.importFailed || "Bank import failed: {message}")
                .replace("{message}", err instanceof Error ? err.message : String(err));
            toast.error(message);
        } finally {
            setImportingId(null);
        }
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle>{t.banks.sharedTitle}</CardTitle>
                <Button type="button" variant="ghost" size="sm" onClick={loadIndex} disabled={loading}>
                    <RefreshCw className={loading ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
                    {t.banks.sharedRefresh}
                </Button>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{t.banks.sharedHint}</p>
                {loading ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t.banks.sharedLoading}
                    </p>
                ) : failed ? (
                    <p className="text-sm text-destructive">{t.banks.sharedFailed}</p>
                ) : packages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t.banks.sharedEmpty}</p>
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {packages.map((item) => {
                            const imported = importedNames.has(item.title.trim());
                            return (
                                <div key={item.id} className="rounded-lg border border-border p-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="truncate font-medium">{item.title}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {t.banks.stageNames[STAGE_KEYS[item.stage] ?? "primary"]}
                                                {" · "}
                                                {t.tags.subjects[item.subject as keyof typeof t.tags.subjects] ?? item.subject}
                                                {" · "}
                                                {item.count} {t.banks.questions}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {item.tagged ? t.banks.tagged : t.banks.untagged} · {item.license}
                                            </p>
                                        </div>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleImport(item)}
                                            disabled={imported || importingId !== null}
                                        >
                                            {imported ? (
                                                <Check className="h-4 w-4" />
                                            ) : importingId === item.id ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Download className="h-4 w-4" />
                                            )}
                                            <span className="ml-1">
                                                {imported
                                                    ? t.banks.alreadyImported
                                                    : importingId === item.id ? t.banks.sharedImporting : t.banks.sharedImport}
                                            </span>
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
