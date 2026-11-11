"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { toast } from "@/lib/feedback";
import { getApiErrorMessage } from "@/lib/error-message";
import { frontendLogger } from "@/lib/frontend-logger";
import { bankErrorCodeFromMessage } from "@/lib/question-bank/errors";
import { parseBankFile } from "@/lib/question-bank/format";
import { MAX_BANK_QUESTIONS } from "@/lib/question-bank/types";
import type { ParsedBankFile } from "@/lib/question-bank/types";
import type { BankImportResult } from "@/lib/question-bank/types";
import type { Notebook } from "@/types/api";

interface BankImportPanelProps {
    notebooks: Notebook[];
    onImported: () => void;
}

/** 本地题库包导入：默认只进入真题库；勾选后同时写入错题本 */
export function BankImportPanel({ notebooks, onImported }: BankImportPanelProps) {
    const { t } = useLanguage();
    const inputRef = useRef<HTMLInputElement>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [parsed, setParsed] = useState<ParsedBankFile | null>(null);
    const [name, setName] = useState("");
    const [addToErrorItems, setAddToErrorItems] = useState(false);
    const [notebookId, setNotebookId] = useState(notebooks[0]?.id ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rawFile, setRawFile] = useState<unknown>(null);

    // 错题本异步加载：首个错题本到达后补齐默认目标，避免勾选后仍提示未选择
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 依赖异步加载的错题本列表
        if (!notebookId && notebooks[0]) setNotebookId(notebooks[0].id);
    }, [notebooks, notebookId]);

    const handleFile = async (file: File) => {
        setError(null);
        setParsed(null);
        setRawFile(null);
        setFileName(file.name);
        try {
            const raw: unknown = JSON.parse(await file.text());
            const result = parseBankFile(raw);
            if (!result.success) {
                setError(result.error);
                return;
            }
            setRawFile(raw);
            setParsed(result.data);
            setName(result.data.meta.title);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleImport = async () => {
        if (!parsed) return;
        if (addToErrorItems && !notebookId) {
            setError(t.banks.notebookRequired);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const result = await apiClient.post<BankImportResult>("/api/question-banks", {
                file: rawFile,
                name: name.trim() || undefined,
                addToErrorItems,
                notebookId: addToErrorItems ? notebookId : undefined,
            }, { timeout: 300_000, recoverable: true });
            const message = addToErrorItems
                ? (t.banks.importedWithItems || "Imported {name} with {count} questions; {items} added, {duplicates} duplicates.")
                    .replace("{name}", result.bank.name)
                    .replace("{count}", String(result.bank.questionCount))
                    .replace("{items}", String(result.errorItemsCreated))
                    .replace("{duplicates}", String(result.duplicates))
                : (t.banks.imported || "Imported {name} with {count} questions.")
                    .replace("{name}", result.bank.name)
                    .replace("{count}", String(result.bank.questionCount));
            toast.success(message);
            setParsed(null);
            setRawFile(null);
            setFileName(null);
            setName("");
            setAddToErrorItems(false);
            if (inputRef.current) inputRef.current.value = "";
            onImported();
        } catch (err) {
            frontendLogger.error('[Banks]', 'Failed to import bank', { error: err });
            const rawMessage = getApiErrorMessage(err);
            const code = bankErrorCodeFromMessage(rawMessage);
            const message = (code ? t.errors[code] : rawMessage) || (t.banks.importFailed || "Bank import failed: {message}")
                .replace("{message}", err instanceof Error ? err.message : String(err));
            setError(message);
            toast.error(message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t.banks.import}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    {(t.banks.importHint || "Choose a bank package JSON file. Each package holds up to {max} questions.")
                        .replace("{max}", String(MAX_BANK_QUESTIONS))}
                </p>
                <input
                    ref={inputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleFile(file);
                    }}
                />
                <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
                        <Upload className="mr-2 h-4 w-4" />
                        {t.banks.chooseFile}
                    </Button>
                    {fileName && (
                        <span className="text-sm text-muted-foreground">
                            {(t.banks.fileSelected || "Selected {name}").replace("{name}", fileName)}
                            {parsed ? ` · ${parsed.questions.length} ${t.banks.questions}` : ""}
                        </span>
                    )}
                </div>

                {parsed && (
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="space-y-1 text-sm">
                            <span className="font-medium">{t.banks.nameLabel}</span>
                            <input
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                placeholder={t.banks.namePlaceholder}
                                maxLength={200}
                                className="w-full rounded-md border border-border bg-background px-3 py-2"
                            />
                        </label>
                        <div className="space-y-1 text-sm">
                            <span className="font-medium">{t.banks.licenseLabel}</span>
                            <p className="text-muted-foreground">{parsed.meta.license}</p>
                        </div>
                        <label className="flex items-center gap-2 text-sm md:col-span-2">
                            <input
                                type="checkbox"
                                checked={addToErrorItems}
                                onChange={(event) => setAddToErrorItems(event.target.checked)}
                            />
                            {t.banks.addToErrorItems}
                        </label>
                        {addToErrorItems && (
                            <label className="space-y-1 text-sm">
                                <span className="font-medium">{t.banks.targetNotebook}</span>
                                <select
                                    value={notebookId}
                                    onChange={(event) => setNotebookId(event.target.value)}
                                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                                >
                                    {notebooks.map((notebook) => (
                                        <option key={notebook.id} value={notebook.id}>{notebook.name}</option>
                                    ))}
                                </select>
                            </label>
                        )}
                    </div>
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button type="button" onClick={handleImport} disabled={!parsed || busy}>
                    {busy ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {(t.banks.importing || "Importing {count} questions…").replace("{count}", String(parsed?.questions.length ?? 0))}
                        </>
                    ) : (
                        (t.banks.import || "Import Bank") + (parsed ? ` · ${parsed.questions.length}` : "")
                    )}
                </Button>
            </CardContent>
        </Card>
    );
}
